'use strict';

const Graph = require('node-dijkstra')

class Best {
	constructor(host) {
		this.host = host;

		this.graph = {}

		this.outgoing = {}

		setTimeout(() => {
			//console.log(this.graph)
		}, 1000)
	}

	add(src, dst, link, cost, distance) {
		//console.log(this.host, src, dst, link, cost, distance)
		const i = {
			source: src,
			destination: dst,
			link: link,
			cost: cost
		}

		// src
		if(!this.graph[src]) this.graph[src] = {}
		const gFrom = this.graph[src];

		// dst
		if(!gFrom[dst]) gFrom[dst] = {}
		const gNext = gFrom[dst];

		// link
		gNext[link] = i

		// rebuild graph
		this._rebuild()

		return(i);
	}

	remove(src, dst, link) {
		// src
		if(!this.graph[src]) return;
		const gFrom = this.graph[src];

		// dst
		if(!gFrom[dst]) return;
		const gNext = gFrom[dst];

		// link
		if(!gNext[link]) return;

		delete gNext[link];

		if(Object.keys(gNext) == 0) delete gFrom[dst];
		if(Object.keys(this.graph[src]) == 0) delete this.graph[src];

		// rebuild graph
		this._rebuild()

		// return fake path
		return({
			source: src,
			destination: dst,
			link: link
		})
	}

	each(cb) {
		for(var a in this.graph) {
			const from = this.graph[a];
			for(var b in from) {
				const next = from[b];
				for(var c in next) {
					const host = next[c];
					cb(host);
				}
			}
		}
	}

	_rebuild() {
		const graph = new Graph();
		const update = {}

		// follow the graph and build updated nodes
		for(var a in this.graph) {
			const from = this.graph[a];
			if(!update[a]) update[a] = {}
			for(var b in from) {
				const next = from[b];
				for(var c in next) {
					const host = next[c];
					if(!update[host.link]) update[host.link] = {}
					update[a][host.link] = host.cost;
					update[host.link][host.destination] = 1;
				}

			}
		}

		// update dijkstra
		for(var a in update) graph.addNode(a, update[a])

		// from me compute outgoing root
		this.outgoing = {}
		for(var a in this.graph) {
			var path = graph.path(this.host, a, {cost: true})
			if(!path || !path.path || path.length == 0) continue;

			path.link = path.path[1];
			this.outgoing[a] = path;
		}
	}

}
module.exports = Best;
