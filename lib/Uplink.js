'use strict';

const util = require('util');
const ut = require('utjs');
const crypto = require("crypto");

const Serializer = require('./Serializer');
const Sock = require('./Sock');

/**
* The client socket.
*
* @param {Object} opts The Uplink and net.Uplink options.
* @param {Boolean} [opts.reconnect=true] Enable or disable the reconnection.
* @param {Number} [opts.reconnectInterval=1000] The reconnection interval.
* @param {Boolean} [opts.autoConnect=true] Enable or disable the
*        auto connection after instance the class.
* @param {Boolean} [opts.useQueue=true] Enable or disable the usage of an internal
*        queue that will containt the emitted messages while the socket isn't
*        connected. The enqueued messages will be sent as soon as the socket
*        is connected.
* @param {Number} [opts.queueSize=Infinity] The max size of the queue. If the queue is
*        full, new messages will replace old ones.
* @param {Function} [opts.objectSerializer=JSON.stringify] Serializes an object into a binary
*        buffer. This functions allows you to implement custom serialization protocols for
*        the data or even use other known protocols like "Protocol Buffers" or  "MessagePack".
* @param {Function} [opts.objectDeserializer=JSON.parse] Deserializes a binary buffer into an
*        object. This functions allows you to implement custom serialization protocols for the
*        data type "object" or even use other known protocols like "Protocol Buffers" or
*        "MessagePack".
* @constructor
* @augments Sock
* @fires Uplink#connect
* @fires Uplink#reconnecting
* @fires Uplink#socket_connect
* @fires Uplink#socket_drain
* @fires Uplink#end
* @fires Uplink#close
* @fires Uplink#error
*/
function Uplink(opts) {
	opts.messageListener = this._msgListener;
	opts.useQueue = false;
	Uplink.super_.call(this, new Serializer(opts), opts);
	this.psk = opts.psk;
}

util.inherits(Uplink, Sock);

Uplink.prototype._onMessage = function (msg) {
	switch (msg.mt) {
		case Serializer.MT_AUTH_SEED:
			const psk = this.psk || '';

			// compute hmac
			const hmac = crypto.createHmac('sha256', psk);
			hmac.update(msg.data);

			// send computed hmac
			this._send('', hmac.digest('hex'), Serializer.MT_AUTH_HMAC);
			this._send('', this._router.hostname, Serializer.MT_UPLINK);
			break;

		case Serializer.MT_UPLINK:
			this.hostname = msg.data;
			break;

		case Serializer.MT_REGISTER:
			this.id = msg.data;
			this._type = Serializer.MT_UPLINK;

			// add sock to reflector
			this._router.reflector(this)

			/**
			* The socket is connected and registered so {@link Uplink#id}
			* now contains the socket identification.
			*
			* @event Uplink#connect
			*/
			this._superEmit('ready');
			break;

		case Serializer.MT_ERROR:
			this._onError(ut.error(msg.data));
	}
};

module.exports = Uplink;
