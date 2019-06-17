'use strict';
const fs = require("fs")
const PassThrough = require('stream').PassThrough;

const Server = require('../index').Server;
const Socket = require('../index').Socket;
const Router = require('../index').Router;
const Uplink = require('../index').Uplink;

const preSharedKey = "This is a test key";

// create server
const local = new Server({psk: preSharedKey});
local.listen(5000);

var host1 = new Server({psk: preSharedKey});
host1.listen(5001);

const host2 = new Server({psk: preSharedKey});
host2.listen(5002);

const host3 = new Server({psk: preSharedKey});
host3.listen(5003);

const host4 = new Server({psk: preSharedKey});
host4.listen(5004);

const host5 = new Server({psk: preSharedKey});
host5.listen(5005);

const host6 = new Server({psk: preSharedKey});
host6.listen(5006);

// connect some node on each one
for(var a=0; a<5; a++) {
	var sLocal = new Socket({host: 'localhost', port: 5000,	psk: preSharedKey});
	sLocal.join("channel1");
	var sHost1 = new Socket({host: 'localhost', port: 5001,	psk: preSharedKey});
	var sHost2 = new Socket({host: 'localhost', port: 5002,	psk: preSharedKey});
	var sHost3 = new Socket({host: 'localhost', port: 5003,	psk: preSharedKey});
	var sHost4 = new Socket({host: 'localhost', port: 5004,	psk: preSharedKey});
	sHost4.join("channel1");


	var sHost6 = new Socket({host: 'localhost', port: 5006,	psk: preSharedKey});
	var sHost6Bis = new Socket({host: 'localhost', port: 5006,	psk: preSharedKey});
	sHost6.join("channel1");
	sHost6Bis.join("channel1");
}

var sHost4 = new Socket({host: 'localhost', port: 5004,	psk: preSharedKey});
/*
sHost4.join("channel1");

// late close one

	sLocal.join("channel2");
	sHost4.join("channel2");
*/


/*
// late close one
setTimeout(() => {
	sHost1.destroy()
}, 5000)
*/

// group host1 & host2 in a direct event mapping
const router1 = new Router("host1");
router1.addServer(local);
router1.addServer(host1);
router1.addUplink(new Uplink({host: 'localhost', port: 5002, psk: preSharedKey, cost: 10})) // host 2
router1.addUplink(new Uplink({host: 'localhost', port: 5003, psk: preSharedKey, cost: 10})) // host 3

const router2 = new Router("host2");
router2.addServer(host2);
//router2.addUplink(new Uplink({host: 'localhost', port: 5001, psk: preSharedKey})) // host 1
router2.addUplink(new Uplink({host: 'localhost', port: 5004, psk: preSharedKey})) // host 4

const router3 = new Router("host3");
router3.addServer(host3);
router3.addUplink(new Uplink({host: 'localhost', port: 5004, psk: preSharedKey})) // host 4

const router4 = new Router("host4");
router4.addServer(host4);
router4.addUplink(new Uplink({host: 'localhost', port: 5005, psk: preSharedKey})) // host 5

const router5 = new Router("host5");
router5.addServer(host5);
router5.addUplink(new Uplink({host: 'localhost', port: 5006, psk: preSharedKey})) // host 6
//router5.addUplink(new Uplink({host: 'localhost', port: 5001, psk: preSharedKey})) // host 1

const router6 = new Router("host6");
router6.addServer(host6);
router6.addUplink(new Uplink({host: 'localhost', port: 5001, psk: preSharedKey})) // host 1

// late close server
setTimeout(() => {
	//router3.close()

/*
	host1 = new Server({psk: preSharedKey});
	host1.listen(5001);
	*/
}, 1000)

setTimeout(() => {
	//sLocal.leave("channel2");
	//sHost4.leave("channel2");
}, 2000)

setTimeout(() => {
	//console.log("host1", router1._best.graph)
	//console.log("host1", router1._best.outgoing)
	console.log("host1", router1.rooms)
	console.log("host6", router6.rooms)
}, 2000)

/*
sHost3.on('test', (a,b,c,d) => {
	console.log("host6", "congratz", a);
})
*/

sLocal.on('test', (a) => {
	console.log("sLocal", "congratz", a);
})

host6.on('test', (a) => {
	console.log("host6", "congratz", a);
})

sHost3.on('test', (a) => {
	console.log("host3", "congratz", a);
})

setInterval(() => {
	sHost3.emit("test", "proute", {rooms: ['channel1']})
	//sHost2.emit("test", "haha", {rooms: ['channel3']})
	sHost2.emit("test", "broadcast", {broadcast: true})
}, 3000)
// connect uplink from to
