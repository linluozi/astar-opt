// javascript-astar 0.4.1
// http://github.com/bgrins/javascript-astar
// Freely distributable under the MIT License.
// Implements the astar search algorithm in javascript using a Binary Heap.
// Includes Binary Heap (with modifications) from Marijn Haverbeke.
// http://eloquentjavascript.net/appendix2.html
(function(definition) {
  /* global module, define */
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = definition();
  } else if (typeof define === 'function' && define.amd) {
    define([], definition);
  } else {
    var exports = definition();
    window.astar = exports.astar;
    window.Graph = exports.Graph;
  }
})(function() {

function pathTo(node) {
  var curr = node;
  var path = [];
  while (curr.parent) {
    path.push(curr);
    curr = curr.parent;
  }
  path.reverse();
  return path;
}

function getHeap() {
  return new BinaryHeap();
}

var astar = {
  /**
  * Perform an A* Search on a graph given a start and end node.
  * @param {Graph} graph
  * @param {GridNode} start
  * @param {GridNode} end
  * @param {Object} [options]
  * @param {bool} [options.closest] Specifies whether to return the
             path to the closest node if the target is unreachable.
  * @param {Function} [options.heuristic] Heuristic function (see
  *          astar.heuristics).
  */
  search: function(graph, start, end, options) {
    graph.cleanDirty();
    options = options || {};
    var heuristic = options.heuristic || astar.heuristics.manhattan;
    var closest = options.closest || false;
    var openHeap = getHeap();
    var closestNode = start; // set the start node to be the closest if required
    var diagonal = graph.diagonal;
    var grid = graph.grid;
    // Custom graphs (see the CityGraph test) only implement neighbors(); the
    // inlined expansion below is used for the built-in rectangular Grid.
    var isGrid = !!grid && typeof diagonal === 'boolean';
    var currentNode;

    // The start node can be a node that was expanded in an earlier search;
    // its parent chain must be cut or pathTo() would walk into stale links.
    start.f = 0;
    start.g = 0;
    start.parent = null;
    start.closed = false;
    start.visited = false;
    start.h = heuristic(start, end);
    graph.markDirty(start);

    openHeap.push(start);

    // One closure per search, not per node. stepCost is precomputed on the
    // grid path and delegated to node.getCost() for custom graphs.
    function visit(neighbor, stepCost) {
      if (neighbor.closed || neighbor.weight === 0) {
        return;
      }
      var gScore = currentNode.g + stepCost;
      var beenVisited = neighbor.visited;

      if (!beenVisited || gScore < neighbor.g) {
        neighbor.visited = true;
        neighbor.parent = currentNode;
        if (!beenVisited) {
          // h is immutable for a given search, so compute it exactly once.
          neighbor.h = heuristic(neighbor, end);
        }
        neighbor.g = gScore;
        neighbor.f = neighbor.g + neighbor.h;
        if (!beenVisited) {
          graph.markDirty(neighbor);
        }
        if (closest) {
          if (neighbor.h < closestNode.h || (neighbor.h === closestNode.h && neighbor.g < closestNode.g)) {
            closestNode = neighbor;
          }
        }

        if (!beenVisited) {
          openHeap.push(neighbor);
        } else {
          openHeap.rescoreElement(neighbor);
        }
      }
    }

    while (openHeap.content.length > 0) {

      // Grab the lowest f(x) to process next.  Heap keeps this sorted for us.
      currentNode = openHeap.pop();

      // End case -- result has been found, return the traced path.
      if (currentNode === end) {
        return pathTo(currentNode);
      }

      // Normal case -- move currentNode from open to closed, process each of its neighbors.
      currentNode.closed = true;

      var x = currentNode.x;
      var y = currentNode.y;

      if (isGrid) {
        // Same order as Graph.neighbors(): W, E, S, N, SW, SE, NW, NE.
        var col, nb;
        col = grid[x - 1];
        if (col) { nb = col[y]; if (nb) visit(nb, nb.weight); }
        col = grid[x + 1];
        if (col) { nb = col[y]; if (nb) visit(nb, nb.weight); }
        col = grid[x];
        nb = col[y - 1]; if (nb) visit(nb, nb.weight);
        nb = col[y + 1]; if (nb) visit(nb, nb.weight);

        if (diagonal) {
          var colL = grid[x - 1];
          var colR = grid[x + 1];
          // Same order as Graph.neighbors(): SW, SE, NW, NE.
          if (colL) { nb = colL[y - 1]; if (nb) visit(nb, nb.weight * 1.41421); }
          if (colR) { nb = colR[y - 1]; if (nb) visit(nb, nb.weight * 1.41421); }
          if (colL) { nb = colL[y + 1]; if (nb) visit(nb, nb.weight * 1.41421); }
          if (colR) { nb = colR[y + 1]; if (nb) visit(nb, nb.weight * 1.41421); }
        }
      } else {
        var neighbors = graph.neighbors(currentNode);
        for (var i = 0, il = neighbors.length; i < il; ++i) {
          var n = neighbors[i];
          visit(n, n.getCost(currentNode));
        }
      }
    }

    if (closest) {
      return pathTo(closestNode);
    }

    // No result was found - empty array signifies failure to find path.
    return [];
  },
  // See list of heuristics: http://theory.stanford.edu/~amitp/GameProgramming/Heuristics.html
  heuristics: {
    manhattan: function(pos0, pos1) {
      var d1 = Math.abs(pos1.x - pos0.x);
      var d2 = Math.abs(pos1.y - pos0.y);
      return d1 + d2;
    },
    diagonal: function(pos0, pos1) {
      var D = 1;
      var D2 = Math.SQRT2;
      var d1 = Math.abs(pos1.x - pos0.x);
      var d2 = Math.abs(pos1.y - pos0.y);
      return (D * (d1 + d2)) + ((D2 - (2 * D)) * Math.min(d1, d2));
    }
  },
  cleanNode: function(node) {
    node.f = 0;
    node.g = 0;
    node.h = 0;
    node.visited = false;
    node.closed = false;
    node.parent = null;
    node._heapIndex = -1;
  }
};

/**
 * A graph memory structure
 * @param {Array} gridIn 2D array of input weights
 * @param {Object} [options]
 * @param {bool} [options.diagonal] Specifies whether diagonal moves are allowed
 */
function Graph(gridIn, options) {
  options = options || {};
  this.nodes = [];
  this.diagonal = !!options.diagonal;
  this.grid = [];
  for (var x = 0; x < gridIn.length; x++) {
    this.grid[x] = [];

    for (var y = 0, row = gridIn[x]; y < row.length; y++) {
      var node = new GridNode(x, y, row[y]);
      this.grid[x][y] = node;
      this.nodes.push(node);
    }
  }
  this.init();
}

Graph.prototype.init = function() {
  this.dirtyNodes = [];
  for (var i = 0; i < this.nodes.length; i++) {
    astar.cleanNode(this.nodes[i]);
  }
};

Graph.prototype.cleanDirty = function() {
  var dirty = this.dirtyNodes;
  for (var i = 0; i < dirty.length; i++) {
    var node = dirty[i];
    // Only these two flags are read before a node is (re)initialised.
    // g/h/f/parent are always written on the first visit of a search, so
    // resetting them here would be dead stores on every touched node.
    node.visited = false;
    node.closed = false;
  }
  // Reuse the backing array: a fresh array per search means ~0.5 MB of
  // garbage on large maps and shows up as GC time.
  dirty.length = 0;
};

Graph.prototype.markDirty = function(node) {
  this.dirtyNodes.push(node);
};

Graph.prototype.neighbors = function(node) {
  var ret = [];
  var x = node.x;
  var y = node.y;
  var grid = this.grid;

  // West
  if (grid[x - 1] && grid[x - 1][y]) {
    ret.push(grid[x - 1][y]);
  }

  // East
  if (grid[x + 1] && grid[x + 1][y]) {
    ret.push(grid[x + 1][y]);
  }

  // South
  if (grid[x] && grid[x][y - 1]) {
    ret.push(grid[x][y - 1]);
  }

  // North
  if (grid[x] && grid[x][y + 1]) {
    ret.push(grid[x][y + 1]);
  }

  if (this.diagonal) {
    // Southwest
    if (grid[x - 1] && grid[x - 1][y - 1]) {
      ret.push(grid[x - 1][y - 1]);
    }

    // Southeast
    if (grid[x + 1] && grid[x + 1][y - 1]) {
      ret.push(grid[x + 1][y - 1]);
    }

    // Northwest
    if (grid[x - 1] && grid[x - 1][y + 1]) {
      ret.push(grid[x - 1][y + 1]);
    }

    // Northeast
    if (grid[x + 1] && grid[x + 1][y + 1]) {
      ret.push(grid[x + 1][y + 1]);
    }
  }

  return ret;
};

Graph.prototype.toString = function() {
  var graphString = [];
  var nodes = this.grid;
  for (var x = 0; x < nodes.length; x++) {
    var rowDebug = [];
    var row = nodes[x];
    for (var y = 0; y < row.length; y++) {
      rowDebug.push(row[y].weight);
    }
    graphString.push(rowDebug.join(" "));
  }
  return graphString.join("\n");
};

function GridNode(x, y, weight) {
  this.x = x;
  this.y = y;
  this.weight = weight;
  this._heapIndex = -1;
}

GridNode.prototype.toString = function() {
  return "[" + this.x + " " + this.y + "]";
};

GridNode.prototype.getCost = function(fromNeighbor) {
  // Take diagonal weight into consideration.
  if (fromNeighbor && fromNeighbor.x != this.x && fromNeighbor.y != this.y) {
    return this.weight * 1.41421;
  }
  return this.weight;
};

GridNode.prototype.isWall = function() {
  return this.weight === 0;
};

function BinaryHeap() {
  this.content = [];
}

BinaryHeap.prototype = {
  push: function(element) {
    // Add the new element to the end of the array.
    this.content.push(element);
    element._heapIndex = this.content.length - 1;

    // Allow it to sink down.
    this.sinkDown(this.content.length - 1);
  },
  pop: function() {
    // Store the first element so we can return it later.
    var result = this.content[0];
    // Get the element at the end of the array.
    var end = this.content.pop();
    result._heapIndex = -1;
    // If there are any elements left, put the end element at the
    // start, and let it bubble up.
    if (this.content.length > 0) {
      this.content[0] = end;
      end._heapIndex = 0;
      this.bubbleUp(0);
    }
    return result;
  },
  remove: function(node) {
    var i = node._heapIndex;
    // Fall back to a scan when the cached index is missing or stale, so
    // remove() stays correct for elements that were never pushed by us.
    if (i == null || i < 0 || this.content[i] !== node) {
      i = this.content.indexOf(node);
      if (i === -1) {
        return;
      }
    }

    // When it is found, the process seen in 'pop' is repeated
    // to fill the hole.
    var end = this.content.pop();
    node._heapIndex = -1;

    if (i < this.content.length) {
      this.content[i] = end;
      end._heapIndex = i;

      if (end.f < node.f) {
        this.sinkDown(i);
      } else {
        this.bubbleUp(i);
      }
    }
  },
  size: function() {
    return this.content.length;
  },
  rescoreElement: function(node) {
    var i = node._heapIndex;
    if (i == null || i < 0 || this.content[i] !== node) {
      i = this.content.indexOf(node);
      if (i === -1) {
        return;
      }
    }
    this.sinkDown(i);
  },
  sinkDown: function(n) {
    // Fetch the element that has to be sunk.
    var element = this.content[n];

    // When at 0, an element can not sink any further.
    while (n > 0) {

      // Compute the parent element's index, and fetch it.
      var parentN = ((n + 1) >> 1) - 1;
      var parent = this.content[parentN];
      // Swap the elements if the parent is greater.
      if (element.f < parent.f) {
        this.content[parentN] = element;
        this.content[n] = parent;
        element._heapIndex = parentN;
        parent._heapIndex = n;
        // Update 'n' to continue at the new position.
        n = parentN;
      }
      // Found a parent that is less, no need to sink any further.
      else {
        break;
      }
    }
  },
  bubbleUp: function(n) {
    // Look up the target element and its score.
    var length = this.content.length;
    var element = this.content[n];
    var elemScore = element.f;

    while (true) {
      // Compute the indices of the child elements.
      var child2N = (n + 1) << 1;
      var child1N = child2N - 1;
      // This is used to store the new position of the element, if any.
      var swap = null;
      var child1Score;
      // If the first child exists (is inside the array)...
      if (child1N < length) {
        // Look it up and compute its score.
        var child1 = this.content[child1N];
        child1Score = child1.f;

        // If the score is less than our element's, we need to swap.
        if (child1Score < elemScore) {
          swap = child1N;
        }
      }

      // Do the same checks for the other child.
      if (child2N < length) {
        var child2 = this.content[child2N];
        var child2Score = child2.f;
        if (child2Score < (swap === null ? elemScore : child1Score)) {
          swap = child2N;
        }
      }

      // If the element needs to be moved, swap it, and continue.
      if (swap !== null) {
        this.content[n] = this.content[swap];
        this.content[swap] = element;
        this.content[n]._heapIndex = n;
        element._heapIndex = swap;
        n = swap;
      }
      // Otherwise, we are done.
      else {
        break;
      }
    }
  }
};

return {
  astar: astar,
  Graph: Graph
};

});