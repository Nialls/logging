// setting port and address of the Redis server

var redisPort = process.env.REDISPORT || 6379;
var redisAddress = process.env.REDISADDRESS || "127.0.0.1";


// call the packages we need
var express    = require('express');        // call express
var app        = express();                 // define our app using express
var bodyParser = require('body-parser');    // helps us parse request payloads
var methodOverride = require('method-override'); //better error handling
var request = require('request'); // for sending bid requests to a live endpoint
// redis stuff
if (process.env.REDIS_URL) {
    var rtg   = require("url").parse(process.env.REDIS_URL);
    var client = require("redis").createClient(rtg.port, rtg.hostname);
    redis.auth(rtg.auth.split(":")[1]);
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
app.use(express.static(__dirname + '/public'));

var webPort = process.env.PORT || 6766;        // set our port for web traffic

// ROUTES
// =============================================================================
var router = express.Router();              // get an instance of the express Router

app.get("/", function(req, res) {
 	res.render('index')
});

app.post("/requests/*", function(req, res) {
	var bucketId = req.path.substr(req.path.length - 7);
	var gatewayUrl = decodeURI(req.query.gateway);
	console.log(bucketId);
	console.log(gatewayUrl);
    var gatewayRequestPayload = req.body;
	var hostname = req.headers.host;
	console.log(hostname);
    if (gatewayUrl == undefined) {
        client.hset("requests", bucketId, "something");
    } else {
        request.post({
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
                res.send(JSON.stringify(body));
                client.lpush(bucketId, JSON.stringify({
                    gatewayGuid: String(Date.now()) + randomstring.generate(15),
                    gatewayTimestamp: Date.now(),
                    gatewayRequestUrl: gatewayUrl,
                    gatewayOriginHost: hostname,
                    gatewayBody: JSON.stringify(gatewayRequestPayload),
                    gatewayResponseBody: JSON.stringify(body),
                    gatewayResponseCode: response.statusCode,
                    gatewayResponseHeaders: JSON.stringify(response.headers),
                    gatewayRequestHeaders: JSON.stringify(req.headers)
                }));
            }
        }
        );
    };
});

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
			 	console.log(reply);
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

app.get("/requests/*", function(req, res) {
	var bucketId = req.path.substr(req.path.length - 7);
	console.log(bucketId);
    client.lrange(bucketId, 0, 24, function(err, reply) {
		if (reply) {
            var requestsArray = [];
            for (i = 0; i < reply.length; i++) {
                requestsArray[i] = reply[i];
            };
            
			res.set('content-type', 'application/json');
			res.send(requestsArray);
            console.log(requestsArray);
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