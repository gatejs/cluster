'use strict';

const PassThrough = require('stream').PassThrough;
const util = require('util');
const ut = require('utjs');
const EventEmitter = require('events');
const Graph = require('node-dijkstra')

const Serializer = require('./Serializer');
const Best = require('./Best');

/**
* The router class.
*
* @constructor
* @fires Router#listening
* @fires Router#close
* @fires Router#connection
* @fires Router#error
*/

function Router(hostname) {
	Router.super_.call(this);
	const self = this;

	this.hostname = hostname;

	this.servers = {};
	this.uplinks = {};
	this.rooms = {}

	// create a best context for this router
	this._best = new Best(this.hostname)
}

util.inherits(Router, EventEmitter);

Router.prototype._superEmit = Router.prototype.emit;

/**
* Add Server interface into the router pool
*
* @param {Server} server Server to add in the pool
* @param {Server} prefix Server address prefix
*/
Router.prototype.addServer = function (server, prefix) {
	prefix = prefix || 'down';

	server._superEmit = Router.prototype._superEmit.bind(this);

	server._emit = Router.prototype._emit.bind(this);
	server._emitToSockets = Router.prototype._emitToSockets.bind(this);
	server._emitToRooms = Router.prototype._emitToRooms.bind(this);
	server._emitBroadcast = Router.prototype._emitBroadcast.bind(this);

	server._stream = Router.prototype._stream.bind(this);
	server._streamToSockets = Router.prototype._streamToSockets.bind(this);
	server._streamToRooms = Router.prototype._streamToRooms.bind(this);
	server._streamBroadcast = Router.prototype._streamBroadcast.bind(this);

	server.join = Router.prototype.join.bind(this);
	server.leave = Router.prototype.leave.bind(this);
	server.leaveAll = Router.prototype.leaveAll.bind(this);

	server.id = prefix+"/"+this._generateServerId();

	server._router = this;

	this.servers[server.id] = server;

};

Router.prototype.addUplink = function (uplink, prefix) {
	prefix = prefix || 'up';
	uplink._router = this;
};


Router.prototype.reflector = function (sock) {
	const self = this;

	sock._router = this;

	this.uplinks[sock.id] = sock;

	//console.log(this.hostname+": Adding socket reflector "+sock.id);

	// at this stage we can remove error logging
	sock.on('error', () => { })

	// waiting the socket to end
	sock.on('end', () => {
		delete this.uplinks[sock.id];

		// remove route from me to host
		var path = this._best.remove(self.hostname, sock.hostname, sock.id)
		self._sendDiscovery('', '', path, Serializer.MT_UL_DEL_LINK)

		// remove route from host to me
		path = this._best.remove(sock.hostname, self.hostname, sock.id)
		self._sendDiscovery('', '', path, Serializer.MT_UL_DEL_LINK)

		//console.log(this.hostname+": Remove socket reflector "+self.hostname, sock.id, sock.hostname);
	})

	// hook commands forever
	sock._onMessage = (msg) => {

		if(msg.mt == Serializer.MT_UL_NEW_LINK) {
			//console.log(this.hostname+" new link: ", msg.data)

			const path = msg.data;

			// join routes
			self._best.add(path.source, path.destination, path.link, path.cost)

			//self._sendUplinks(sock, '', msg.data, Serializer.MT_UL_NEW_LINK);
			//self._sendUplinksBroadcast(msg.cluster, '', msg.data, Serializer.MT_UL_NEW_LINK);
			self._sendDiscovery(msg.cluster, '', path, Serializer.MT_UL_NEW_LINK)
		}
		else if(msg.mt == Serializer.MT_UL_DEL_LINK) {
			//console.log(this.hostname+" delete link: ",  msg.data)

			const path = msg.data;

			// remove internal path
			self._best.remove(path.source, path.destination, path.link)

			// forward message
			self._sendDiscovery(msg.cluster, '', msg.data, Serializer.MT_UL_DEL_LINK);
		}
		else if(msg.mt == Serializer.MT_UL_JOIN_ROOM) {

			const room = msg.data.room;
			const host = msg.data.host;
			const ref = msg.data.ref;

			//console.log(this.hostname+" Join "+host+" #"+room+" ref="+ref);

			self._registerRoom(host, room, ref)
			self._sendUplinksBroadcast(msg.cluster, '', msg.data, Serializer.MT_UL_JOIN_ROOM);
		}
		else if(msg.mt == Serializer.MT_UL_LEAVE_ROOM) {
			const room = msg.data.room;
			const host = msg.data.host;
			const ref = msg.data.ref;

			//console.log(this.hostname+" Leave "+host+" #"+room+" ref="+ref);

			self._unRegisterRoom(host, room, ref)
			self._sendUplinksBroadcast(msg.cluster, '', msg.data, Serializer.MT_UL_LEAVE_ROOM);
		}
		else {
			console.log("MESSAGE", msg.mt, msg.data);
		}
	}

	// place socket in while
	var path = this._best.add(self.hostname, sock.hostname, sock.id, sock._cost)
	self._sendDiscovery('', '', path, Serializer.MT_UL_NEW_LINK)

	// forward all of my route
	this._best.each((path) => {
		// copy back path for discovery
		const npath = Object.assign({}, path)

		// send discovery
		sock._send('', npath, Serializer.MT_UL_NEW_LINK);
	})

	// forward my rooms
	for(var room in this.rooms) {
		const hosts = this.rooms[room]
		for(var host in hosts) {
			const p = {
				host: host,
				room: room,
				ref: hosts[host]
			}

			self._sendUplinksBroadcast(host, '', p, Serializer.MT_UL_JOIN_ROOM);
		}
	}


}



Router.prototype._sendUplinks = function (from, event, data, mt, opts) {
	for(var a in this.uplinks) {
		var uplink = this.uplinks[a];
		if(from && from.id == uplink.id) continue;
		uplink._send(event, data, mt, opts)
	}
}

Router.prototype._sendUplinksBroadcast = function (cluster, event, data, mt, opts) {
	const selected = []
	const sent = {};

	opts = opts || {}
	sent[this.hostname] = true;

	if(cluster) {
		const flip = cluster.split('|');
		for(var a in flip) sent[flip[a]] = true;
	}

	for(var a in this.uplinks) {
		var uplink = this.uplinks[a];
		if(!sent[uplink.hostname]) {
			selected.push(uplink)
			sent[uplink.hostname] = true;
		}
	}

	// send broadcast
	cluster = Object.keys(sent).join('|')
	for(var a in selected) {
		const uplink = selected[a];
		opts.cluster = cluster;
		uplink._send(event, data, mt, opts);
	}
}


Router.prototype._sendDiscovery = function (cluster, event, data, mt, opts) {
	const selected = []
	const sent = {};

	opts = opts || {}
	sent[this.hostname] = true;

	if(cluster) {
		const flip = cluster.split('|');
		for(var a in flip) sent[flip[a]] = true;
	}

	for(var a in this.uplinks) {
		var uplink = this.uplinks[a];
		if(!sent[uplink.hostname]) {
			selected.push(uplink)
			//sent[uplink.hostname] = true;
		}
	}

	// send broadcast
	cluster = Object.keys(sent).join('|')
	for(var a in selected) {
		const uplink = selected[a];
		opts.cluster = cluster;
		uplink._send(event, data, mt, opts);
	}
}

Router.prototype._registerRoom = function (host, room, ref) {
	// add routing room
	if(!this.rooms[room]) this.rooms[room] = {}
	if(!this.rooms[room][host]) this.rooms[room][host] = 0;

	if(!ref) this.rooms[room][host]++;
	else this.rooms[room][host] = ref;

	return({
		host: host,
		room: room,
		ref: this.rooms[room][host]
	})
}

Router.prototype._unRegisterRoom = function(host, room, ref) {

	if(!this.rooms[room]) return;
	if(!this.rooms[room][host]) return;

	if(!ref) this.rooms[room][host]--;
	else this.rooms[room][host] = ref;

	const ret = {
		host: host,
		room: room,
		ref: this.rooms[room][host]
	}

	// do delete
	if(this.rooms[room][host] === 0) {
		delete this.rooms[room][host]
		if(Object.keys(this.rooms[room]).length === 0) {
			delete this.rooms[room];
		}
	}

	return(ret);
}

/**
* Emit an event, if no sockets or rooms are provided, the event
* will be broadcasted to all connected sockets.
*
* @param {String} event The event name.
* @param {String|Number|Object|Buffer|Boolean} data The data to send.
* @param {Object} [opts] The options.
* @param {String[]} [opts.sockets=[]] The list of socket ids to send.
* @param {String[]} [opts.rooms=[]] The list of rooms to send.
* @param {String[]} [opts.except=[]] The list of socket ids to exclude.
*/
Router.prototype.emit = function (event, data, opts) {
	opts = ut.isObject(opts) ? opts : {};
	this._emit(event, data, opts);
};

/**
* Creates and returns a stream.Writable instance that can be used to stream
* binary data. If no opts.sockets or opts.rooms are provided, the stream
* will be broadcasted to all connected sockets.
*
* @param {String} event The event name.
* @param {String|Number|Object|Buffer|Boolean} data The data to send.
* @param {Object} [opts] The options.
* @param {String[]} [opts.sockets=[]] The list of socket ids to send.
* @param {String[]} [opts.rooms=[]] The list of rooms to send.
* @param {String[]} [opts.except=[]] The list of socket ids to exclude.
*/
Router.prototype.stream = function (event, data, opts) {
	opts = ut.isObject(opts) ? opts : {};
	return this._stream(event, data, opts);
};

/**
* Join to a room.
*
* @param {String} room The room name.
* @param {String} socketId The socket id.
*/
Router.prototype.join = function (room, socketId) {
	const host = this.hostname;

	for(var a in this.servers) {
		var server = this.servers[a];
		var socket = server.sockets[socketId];

		if(socket === undefined) continue;

		if (server.rooms[room] === undefined) {
			server.rooms[room] = [];
		}

		var sockets = server.rooms[room];
		if (sockets.indexOf(socket) === -1) {
			sockets.push(socket);
			socket._rooms[room] = true;
		}
	}

	var packet = this._registerRoom(host, room);
	this._sendUplinksBroadcast(null, '', packet, Serializer.MT_UL_JOIN_ROOM);
};


/**
* Leave a room.
*
* @param {String} room The room name.
* @param {String} socketId The socket id.
*/
Router.prototype.leave = function (room, socketId) {
	const host = this.hostname;

	for(var a in this.servers) {
		var server = this.servers[a];
		var socket = server.sockets[socketId];
		var sockets = server.rooms[room];

		if (socket !== undefined && sockets !== undefined) {
			var index = sockets.indexOf(socket);
			if (index > -1) {
				sockets.splice(index, 1);
				if (sockets.length === 0) {
					delete server.rooms[room];
				}
				delete socket._rooms[room];
			}
		}
	}

	var packet = this._unRegisterRoom(host, room);
	this._sendUplinksBroadcast(null, '', packet, Serializer.MT_UL_LEAVE_ROOM);
};

/**
* Leave all rooms.
*
* @param {String} socketId The socket id.
*/
Router.prototype.leaveAll = function (socketId) {
	for(var a in this.servers) {
		var server = this.servers[a];
		var socket = server.sockets[socketId];

		if (socket !== undefined) {
			for (var room in socket._rooms) {
				this.leave(room, socketId);
			}
		}
	}
};

/**
* Disconnect all the clients and close all servers.
*/
Router.prototype.close = function () {
	for(var a in this.uplinks) {
		this.uplinks[a].destroy();
	}
	for(var a in this.servers) {
		this.servers[a].close();
	}
};

Router.prototype._emit = function (event, data, opts) {
	var socketIds = ut.isArray(opts.sockets) ? opts.sockets : [];
	var rooms = ut.isArray(opts.rooms) ? opts.rooms : [];
	var except = ut.isArray(opts.except)  ? opts.except : [];

	if (socketIds.length > 0) {
		this._emitToSockets(event, data, socketIds, except);
	}

	if (rooms.length > 0) {
		this._emitToRooms(event, data, rooms, except);
	}

	if (socketIds.length + rooms.length === 0) {
		this._emitBroadcast(event, data, except);
	}
};

Router.prototype._emitToSockets = function (event, data, socketIds, except) {
	for(var a in this.servers) {
		var server = this.servers[a];

		for (var i = 0; i < socketIds.length; i++) {
			var socket = server.sockets[socketIds[i]];
			if (socket !== undefined && except.indexOf(socket.id) === -1) {
				socket.emit(event, data);
			}
		}
	}
};

Router.prototype._emitToRooms = function (event, data, rooms, except) {

	console.log(event, data, rooms, except)
	for(var a in this.servers) {
		var server = this.servers[a];

		for (var i = 0; i < rooms.length; i++) {
			var sockets = server.rooms[rooms[i]];
			if (sockets !== undefined) {
				for (var j = 0; j < sockets.length; j++) {
					var socket = sockets[j];
					if (except.indexOf(socket.id) === -1) {
						socket.emit(event, data);
					}
				}
			}
		}
	}
};

Router.prototype._emitBroadcast = function (event, data, except) {
	for(var a in this.servers) {
		var server = this.servers[a];
		for (var socketId in server.sockets) {
			if (except.indexOf(socketId) === -1) {
				server.sockets[socketId].emit(event, data);
			}
		}
	}
};

Router.prototype._stream = function (event, data, opts) {
	var socketIds = ut.isArray(opts.sockets) ? opts.sockets : [];
	var rooms = ut.isArray(opts.rooms) ? opts.rooms : [];
	var except = ut.isArray(opts.except)  ? opts.except : [];

	if (socketIds.length > 0) {
		return this._streamToSockets(event, data, socketIds, except);
	}

	if (rooms.length > 0) {
		return this._streamToRooms(event, data, rooms, except);
	}

	return this._streamBroadcast(event, data, except);
};

Router.prototype._streamToSockets = function (event, data, socketIds, except) {
	var writableStream = new PassThrough();

	for(var a in this.servers) {
		var server = this.servers[a];
		for (var i = 0; i < socketIds.length; i++) {
			var socket = server.sockets[socketIds[i]];
			if (socket !== undefined && except.indexOf(socket.id) === -1) {
				writableStream.pipe(socket.stream(event, data));
			}
		}
	}

	return writableStream;
};

Router.prototype._streamToRooms = function (event, data, rooms, except) {
	var writableStream = new PassThrough();

	for(var a in this.servers) {
		var server = this.servers[a];
		for (var i = 0; i < rooms.length; i++) {
			var sockets = server.rooms[rooms[i]];
			if (sockets !== undefined) {
				for (var j = 0; j < sockets.length; j++) {
					var socket = sockets[j];
					if (except.indexOf(socket.id) === -1) {
						writableStream.pipe(socket.stream(event, data));
					}
				}
			}
		}
	}

	return writableStream;
};

Router.prototype._streamBroadcast = function (event, data, except) {
	var writableStream = new PassThrough();

	for(var a in this.servers) {
		var server = this.servers[a];

		for (var socketId in server.sockets) {
			if (except.indexOf(socketId) === -1) {
				writableStream.pipe(server.sockets[socketId].stream(event, data));
			}
		}
	}

	return writableStream;
};

Router.prototype._generateServerId = function () {
	var serverId;
	var from = 2;

	do {
		serverId = ut.randomString(from);
		from++;
	} while (this.servers[serverId] !== undefined);

	return serverId;
};

module.exports = Router;
