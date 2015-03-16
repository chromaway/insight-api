'use strict';

/**
 * Module dependencies.
 */
var crypto      = require('crypto');
var bufferEqual = require('buffer-equal');
var Address     = require('../models/Address');
var async       = require('async');
var common      = require('./common');
var util        = require('util');

var imports = require('soop').imports();
var Rpc     = imports.rpc || require('../../lib/Rpc');

var tDb = require('../../lib/TransactionDb').default();
var bdb = require('../../lib/BlockDb').default();

exports.send = function(req, res) {
  Rpc.sendRawTransaction(req.body.rawtx, function(err, txid) {
    if (err) {
      var message;
      if(err.code == -25) {
        message = util.format(
          'Generic error %s (code %s)',
          err.message, err.code);
      } else if(err.code == -26) {
        message = util.format(
          'Transaction rejected by network (code %s). Reason: %s',
          err.code, err.message);
      } else {
        message = util.format('%s (code %s)', err.message, err.code);
      }
      return res.status(400).send(message);
    }
    res.json({'txid' : txid});
  });
};


/**
 * Find transaction by hash ...
 */
exports.transaction = function(req, res, next, txid) {

  tDb.fromIdWithInfo(txid, function(err, tx) {
    if (err || ! tx)
      return common.handleErrors(err, res);
    else {
      req.transaction = tx.info;
      return next();
    }
  });
};


/**
 * Show transaction
 */
exports.show = function(req, res) {
  tDb.fromIdWithInfo(req.params.txid, function(err, tx) {
    if (err || ! tx) {
      return common.handleErrors(err, res);
    }

    res.jsonp(tx.info);
  });
};


/**
 * Get raw transaction
 */
exports.getRaw = function(req, res) {
  Rpc.getRawTransaction(req.params.txid, function(err, rawtx) {
    if (err || !rawtx) {
      return common.handleErrors(err, res);
    }

    res.jsonp({txid: req.params.txid, hex: rawtx});
  });
}

function decode(s) {
  return Array.prototype.reverse.call(new Buffer(s, 'hex'))
}

function encode(s) {
  return Array.prototype.reverse.call(new Buffer(s)).toString('hex')
}

exports.getMerkle = function(req, res) {
  var txid = req.params.txid
  Rpc.getTxInfo(txid, function(err, txInfo) {
    if (err || !txInfo) {
      return common.handleErrors(err, res);
    }

    if (typeof txInfo.blockhash === 'undefined') {
      return res.jsonp({status: 'unconfirmed', data: null})
    }

    bdb.fromHashWithInfo(txInfo.blockhash, function (err, block) {
      if (err) { return common.handleErrors(err, res); }
      if (!block.info.isMainChain) {
        return res.jsonp({status: 'invalid', data: null});
      }

      var merkle = [];
      var targetHash = decode(txid)
      var txs = block.info.tx.map(decode);
      while (txs.length !== 1) {
        if (txs.length % 2 === 1) { txs.push(txs[txs.length-1]); }

        var newTxs = [];
        for (var i = 0; i < txs.length; i += 2) {
          var newHash = Buffer.concat([txs[i], txs[i+1]]);
          newHash = crypto.createHash('sha256').update(newHash).digest();
          newHash = crypto.createHash('sha256').update(newHash).digest();
          newTxs.push(newHash);

          if (bufferEqual(txs[i], targetHash)) {
            merkle.push(encode(txs[i + 1]));
            targetHash = newHash;
          } else if (bufferEqual(txs[i+1], targetHash)) {
            merkle.push(encode(txs[i]));
            targetHash = newHash;
          }
        }
        txs = newTxs;
      }

      return res.jsonp({
        status: 'confirmed',
        data: {
          blockHeight: block.info.height,
          blockHash: block.hash,
          index: block.info.tx.indexOf(txid),
          merkle: merkle
        }
      });
    })
  })
}

var getTransaction = function(txid, cb) {

  tDb.fromIdWithInfo(txid, function(err, tx) {
    if (err) console.log(err);

    if (!tx || !tx.info) {
      console.log('[transactions.js.48]:: TXid %s not found in RPC. CHECK THIS.', txid);
      return ({ txid: txid });
    }

    return cb(null, tx.info);
  });
};


/**
 * List of transaction
 */
exports.list = function(req, res, next) {
  var bId = req.query.block;
  var addrStr = req.query.address;
  var page = req.query.pageNum;
  var pageLength = 10;
  var pagesTotal = 1;
  var txLength;
  var txs;

  if (bId) {
    bdb.fromHashWithInfo(bId, function(err, block) {
      if (err) {
        console.log(err);
        return res.status(500).send('Internal Server Error');
      }

      if (! block) {
        return res.status(404).send('Not found');
      }

      txLength = block.info.tx.length;

      if (page) {
        var spliceInit = page * pageLength;
        txs = block.info.tx.splice(spliceInit, pageLength);
        pagesTotal = Math.ceil(txLength / pageLength);
      }
      else {
        txs = block.info.tx;
      }

      async.mapSeries(txs, getTransaction, function(err, results) {
        if (err) {
          console.log(err);
          res.status(404).send('TX not found');
        }

        res.jsonp({
          pagesTotal: pagesTotal,
          txs: results
        });
      });
    });
  }
  else if (addrStr) {
    var a = new Address(addrStr);

    a.update(function(err) {
      if (err && !a.totalReceivedSat) {
        console.log(err);
        res.status(404).send('Invalid address');
        return next();
      }

      txLength = a.transactions.length;

      if (page) {
        var spliceInit = page * pageLength;
        txs = a.transactions.splice(spliceInit, pageLength);
        pagesTotal = Math.ceil(txLength / pageLength);
      }
      else {
        txs = a.transactions;
      }

      async.mapSeries(txs, getTransaction, function(err, results) {
        if (err) {
          console.log(err);
          res.status(404).send('TX not found');
        }

        res.jsonp({
          pagesTotal: pagesTotal,
          txs: results
        });
      });
    });
  }
  else {
    res.jsonp({
      txs: []
    });
  }
};
