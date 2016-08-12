// setting port and address of the Redis server if we're not using Heroku

var redisPort = process.env.REDISPORT || 6379;
var redisAddress = process.env.REDISADDRESS || "127.0.0.1";


// call the packages we need
var express    = require('express');        // call express
var app        = express();                 // define our app using express
var bodyParser = require('body-parser');    // helps us parse request payloads
var methodOverride = require('method-override'); //better error handling
var request = require('request'); // for sending bid requests to a live endpoint

// if we're using heroku then grab the redis deets from the env variable in heroku, if not, use localhost and 6379
if (process.env.REDIS_URL) {
    var rtg   = require("url").parse(process.env.REDIS_URL);
    var client = require("redis").createClient(rtg.port, rtg.hostname);
    client.auth(rtg.auth.split(":")[1]);
} else {
    var client = require("redis").createClient(redisPort, redisAddress);
};

var randomstring = require("randomstring"); // call randomstring for creating random strings to name buckets

client.on('connect', function() {
    console.log('connected to redis database');
}); // connect to redis database

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // allows us to parse JSON in request bodies

app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public')); // for rendering static resources, like the UI

var webPort = process.env.PORT || 6766;        // set our port for web traffic

// ROUTES
// =============================================================================
var router = express.Router();              // get an instance of the express Router

app.get("/", function(req, res) {
 	res.render('index'), {root : './'}
});

// handles a request that needs to be logged
app.post("/requests/*", function(req, res) {
	var bucketId = req.path.substr(req.path.length - 7);
	var gatewayUrl = decodeURI(req.query.gateway); // this is the URL that we need to make the secondary request to
	console.log(bucketId);
	console.log(gatewayUrl);
    var gatewayRequestPayload = req.body;
	var hostname = req.headers.host;
	console.log(hostname);
    if (gatewayUrl == undefined) {
        client.hset("requests", bucketId, "something"); // TODO: Something if there's no gatewayUrl defined
    } else {
        request.post({
            time: true,
            headers: {'X-Openrtb-Version' : '2.2'},
            url: gatewayUrl,
            body: JSON.stringify(gatewayRequestPayload)
        }, function (error, response, body) {
            console.log(response.statusCode);
            if (error) {
                res.send("EndpointError");
            } else {
                res.set(response.headers);
                res.status(response.statusCode);
                res.send(body);
                console.log("Response time: " + response.elapsedTime);
                // push all of the information to the redis db for storage
                client.lpush(bucketId, JSON.stringify({
                    gatewayGuid: String(Date.now()) + randomstring.generate(15),
                    gatewayTimestamp: Date.now(),
                    gatewayRequestUrl: gatewayUrl,
                    gatewayOriginHost: hostname,
                    gatewayBody: JSON.stringify(gatewayRequestPayload),
                    gatewayResponseBody: body,
                    gatewayResponseCode: response.statusCode,
                    gatewayResponseHeaders: JSON.stringify(response.headers),
                    gatewayRequestHeaders: JSON.stringify(req.headers),
                    gatewayResponseTime: response.elapsedTime
                }));
            }
        }
        );
    };
});

// create a new bucket
app.post("/create-bucket", function(req, res) {
	console.log(req);
	var newBucketName = req.body.name;
	var newBucketDesc = req.body.desc;
	console.log("Create bucket!");
	var rngBucketId = randomstring.generate(7);
	console.log("Trying ID: " + rngBucketId);
	client.exists(rngBucketId, function(err, reply) {
	    if (reply !== 1) {
	    	console.log("Success - writing to DB");
	        client.hset("buckets", rngBucketId, JSON.stringify({
			    'name': newBucketName,
			    'desc': newBucketDesc,
                'id': rngBucketId,
			    'created': Date.now()
			}), function(err, reply) {
			 	client.hget("buckets", rngBucketId, function(err, reply) {
			 		if (reply) {
                        res.set('Content-Type', 'application/json');
			 			res.send(reply);
			 		} else {
			 			res.send(err);
			 		}
				});
			});
	    } else {
	    	console.log("Match found - try again");
	    }
	});
});


// edit an existing bucket
app.post("/edit-bucket", function(req, res) {
	console.log(req);
	var editBucketName = req.body.name;
	var editBucketDesc = req.body.desc;
    var editBucketId   = req.body.id;
	client.exists(editBucketId, function(err, reply) {
	    if (reply == 1) {
	    	console.log("Success - writing to DB");
	        client.hset("buckets", editBucketId, JSON.stringify({
			    'name': editBucketName,
			    'desc': editBucketDesc,
                'id': editBucketId,
			    'created': Date.now()
			}), function(err, reply) {
			 	console.log(reply);
			 	client.hget("buckets", editBucketId, function(err, reply) {
			 		if (reply) {
                        res.set('Content-Type', 'application/json');
			 			res.send(reply);
			 		} else {
			 			res.send(err);
			 		}
				});
			});
	    } else {
	    	console.log("This bucket doesn't exist");
	    }
	});
});

// gets a list of all buckets
app.get("/buckets", function(req, res) {
	client.hgetall("buckets", function(err, reply) {
		if (reply) {
			res.set('content-type', 'application/json');
			res.send(reply);
		} else {
			res.send(err);
		}
	});
});

// gets the descriptive information for a specific bucket
app.get("/buckets/*", function(req, res) {
	var bucketId = req.path.substr(req.path.length - 7);
	console.log(bucketId);
    client.hget("buckets", bucketId, function(err, reply) {
		if (reply) {
			res.set('content-type', 'application/json');
			res.send(reply);
		} else {
			res.send("Bucket doesn't exist.");
		}
	});
});

// gets last 25 requests from a specific bucket
app.get("/requests/*", function(req, res) {
    if (req.query.range) {
        var requestRange = req.query.range
    } else {
        var requestRange = 24
    };
	var bucketId = req.path.substr(req.path.length - 7);
	console.log(bucketId);
    client.lrange(bucketId, 0, requestRange, function(err, reply) {
		if (reply) {
            var requestsArray = [];
            for (i = 0; i < reply.length; i++) {
                requestsArray[i] = reply[i];
            };
            
			res.set('content-type', 'application/json');
			res.send(requestsArray);
		} else {
			res.send("Bucket doesn't exist.");
		}
	});
});

// all routes use root
app.use('/', router);

// START THE SERVER
// =============================================================================
app.listen(webPort);
console.log('Magic happens on port ' + webPort);
