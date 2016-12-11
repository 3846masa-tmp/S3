import http from 'http';
import https from 'https';
import cluster from 'cluster';
import arsenal from 'arsenal';

import { logger } from './utilities/logger';
import { clientCheck } from './utilities/healthcheckHandler';
import _config from './Config';
import routes from './routes';

console.log("Server response inherited functions!!", http.ServerResponse.super_.prototype)

console.log("Server inherited functions!!", http.Server.super_.prototype)

const connectionExpression = /^Connection$/i;
const transferEncodingExpression = /^Transfer-Encoding$/i;
const closeExpression = /close/i;
const contentLengthExpression = /^Content-Length$/i;
const dateExpression = /^Date$/i;
const expectExpression = /^Expect$/i;
const trailerExpression = /^Trailer$/i;
const lenientHttpHeaders = !!process.REVERT_CVE_2016_2216;
const CRLF = '\r\n';
const automaticHeaders = {
  connection: true,
  'content-length': true,
  'transfer-encoding': true,
  date: true
};

const lenientCheckIsHttpToken = function(val){
    console.log("called lenientCheckIsHttpToken!!")
    if (typeof val !== 'string' || val.length === 0)
        return false;

      for (var i = 0, len = val.length; i < len; i++) {
        var ch = val.charCodeAt(i);

        if (ch >= 65 && ch <= 90) // A-Z
          continue;

        if (ch >= 97 && ch <= 122) // a-z
          continue;

        // ^ => 94
        // _ => 95
        // ` => 96
        // | => 124
        // ~ => 126
        if (ch === 94 || ch === 95 || ch === 96 || ch === 124 || ch === 126)
          continue;
// changed 48 to 47 to allow slash
        if (ch >= 47 && ch <= 57) // 0-9
          continue;

        // ! => 33
        // # => 35
        // $ => 36
        // % => 37
        // & => 38
        // ' => 39
        // * => 42
        // + => 43
        // - => 45
        // . => 46
        if (ch >= 33 && ch <= 46) {
          if (ch === 34 || ch === 40 || ch === 41 || ch === 44)
            return false;
          continue;
        }

        return false;
      }
      return true;
}

const lenientCheckInvalidHeaderChar = function(val){
    console.log("called lenientCheckInvalidHeaderChar!!")
    val = '' + val;
      for (var i = 0; i < val.length; i++) {
        const ch = val.charCodeAt(i);
        if (ch === 9) continue;
        if (ch <= 31 || ch > 255 || ch === 127) return true;
      }
      return false;
}

const escapeHeaderValue = function escapeHeaderValue(value) {
  if (!lenientHttpHeaders) return value;
  // Protect against response splitting. The regex test is there to
  // minimize the performance impact in the common case.
  return /[\r\n]/.test(value) ? value.replace(/[\r\n]+[ \t]*/g, '') : value;
};

const storeHeader = function storeHeader(self, state, field, value) {
  if (!lenientHttpHeaders) {
    if (!lenientCheckIsHttpToken(field)) {
      throw new TypeError(
        'Header name must be a valid HTTP Token ["' + field + '"]');
    }
    if (lenientCheckInvalidHeaderChar(value) === true) {
      throw new TypeError('The header content contains invalid characters');
    }
  }
  state.messageHeader += field + ': ' + escapeHeaderValue(value) + CRLF;

  if (connectionExpression.test(field)) {
    state.sentConnectionHeader = true;
    if (closeExpression.test(value)) {
      self._last = true;
    } else {
      self.shouldKeepAlive = true;
    }

  } else if (transferEncodingExpression.test(field)) {
    state.sentTransferEncodingHeader = true;
    if (chunkExpression.test(value)) self.chunkedEncoding = true;

  } else if (contentLengthExpression.test(field)) {
    state.sentContentLengthHeader = true;
  } else if (dateExpression.test(field)) {
    state.sentDateHeader = true;
  } else if (expectExpression.test(field)) {
    state.sentExpect = true;
  } else if (trailerExpression.test(field)) {
    state.sentTrailer = true;
  }
}

http.ServerResponse.super_.prototype.addTrailers = function(headers) {
    console.log("called add trailers!!")
  this._trailer = '';
  var keys = Object.keys(headers);
  var isArray = Array.isArray(headers);
  var field, value;
  for (var i = 0, l = keys.length; i < l; i++) {
    var key = keys[i];
    if (isArray) {
      field = headers[key][0];
      value = headers[key][1];
    } else {
      field = key;
      value = headers[key];
    }
    if (!lenientHttpHeaders) {
      if (!lenientCheckIsHttpToken(field)) {
        throw new TypeError(
          'Trailer name must be a valid HTTP Token ["' + field + '"]');
      }
      if (lenientCheckInvalidHeaderChar(value) === true) {
        throw new TypeError('The header content contains invalid characters');
      }
    }
    this._trailer += field + ': ' + escapeHeaderValue(value) + CRLF;
  }
};

http.ServerResponse.super_.prototype.setHeader = function(name, value) {
    console.log('called set header!!')
  if (typeof name !== 'string')
    throw new TypeError('`name` should be a string in setHeader(name, value).');
  if (value === undefined)
    throw new Error('`value` required in setHeader("' + name + '", value).');
  if (this._header)
    throw new Error('Can\'t set headers after they are sent.');
  if (!lenientHttpHeaders) {
    if (!lenientCheckIsHttpToken(name)) {
      throw new TypeError(
        'Trailer name must be a valid HTTP Token ["' + name + '"]');
    }
    if (lenientCheckInvalidHeaderChar(value) === true) {
      throw new TypeError('The header content contains invalid characters');
    }
  }
  if (this._headers === null)
    this._headers = {};

  var key = name.toLowerCase();
  this._headers[key] = value;
  this._headerNames[key] = name;

  if (automaticHeaders[key])
    this._removedHeader[key] = false;
};

http.ServerResponse.super_.prototype._storeHeader = function(firstLine, headers) {
    console.log("called storeheader!!")
  // firstLine in the case of request is: 'GET /index.html HTTP/1.1\r\n'
  // in the case of response it is: 'HTTP/1.1 200 OK\r\n'
  var state = {
    sentConnectionHeader: false,
    sentContentLengthHeader: false,
    sentTransferEncodingHeader: false,
    sentDateHeader: false,
    sentExpect: false,
    sentTrailer: false,
    messageHeader: firstLine
  };

  if (headers) {
    var keys = Object.keys(headers);
    var isArray = Array.isArray(headers);
    var field, value;

    for (var i = 0, l = keys.length; i < l; i++) {
      var key = keys[i];
      if (isArray) {
        field = headers[key][0];
        value = headers[key][1];
      } else {
        field = key;
        value = headers[key];
      }

      if (Array.isArray(value)) {
        for (var j = 0; j < value.length; j++) {
          storeHeader(this, state, field, value[j]);
        }
      } else {
        storeHeader(this, state, field, value);
      }
    }
  }

  // Date header
  if (this.sendDate === true && state.sentDateHeader === false) {
    state.messageHeader += 'Date: ' + utcDate() + CRLF;
  }

  // Force the connection to close when the response is a 204 No Content or
  // a 304 Not Modified and the user has set a "Transfer-Encoding: chunked"
  // header.
  //
  // RFC 2616 mandates that 204 and 304 responses MUST NOT have a body but
  // node.js used to send out a zero chunk anyway to accommodate clients
  // that don't have special handling for those responses.
  //
  // It was pointed out that this might confuse reverse proxies to the point
  // of creating security liabilities, so suppress the zero chunk and force
  // the connection to close.
  var statusCode = this.statusCode;
  if ((statusCode === 204 || statusCode === 304) &&
      this.chunkedEncoding === true) {
    console.log(statusCode + ' response should not use chunked encoding,' +
          ' closing connection.');
    this.chunkedEncoding = false;
    this.shouldKeepAlive = false;
  }

  // keep-alive logic
  if (this._removedHeader.connection) {
    this._last = true;
    this.shouldKeepAlive = false;
  } else if (state.sentConnectionHeader === false) {
    var shouldSendKeepAlive = this.shouldKeepAlive &&
        (state.sentContentLengthHeader ||
         this.useChunkedEncodingByDefault ||
         this.agent);
    if (shouldSendKeepAlive) {
      state.messageHeader += 'Connection: keep-alive\r\n';
    } else {
      this._last = true;
      state.messageHeader += 'Connection: close\r\n';
    }
  }

  if (state.sentContentLengthHeader === false &&
      state.sentTransferEncodingHeader === false) {
    if (!this._hasBody) {
      // Make sure we don't end the 0\r\n\r\n at the end of the message.
      this.chunkedEncoding = false;
    } else if (!this.useChunkedEncodingByDefault) {
      this._last = true;
    } else {
      if (!state.sentTrailer &&
          !this._removedHeader['content-length'] &&
          typeof this._contentLength === 'number') {
        state.messageHeader += 'Content-Length: ' + this._contentLength +
                               '\r\n';
      } else if (!this._removedHeader['transfer-encoding']) {
        state.messageHeader += 'Transfer-Encoding: chunked\r\n';
        this.chunkedEncoding = true;
      } else {
        // We should only be able to get here if both Content-Length and
        // Transfer-Encoding are removed by the user.
        // See: test/parallel/test-http-remove-header-stays-removed.js
        console.log('Both Content-Length and Transfer-Encoding are removed');
      }
    }
  }

  this._header = state.messageHeader + CRLF;
  this._headerSent = false;

  // wait until the first body chunk, or close(), is sent to flush,
  // UNLESS we're sending Expect: 100-continue.
  if (state.sentExpect) this._send('');
};

console.log("outgoing message functions!!", http.ServerResponse.super_.prototype)

class S3Server {
    /**
     * This represents our S3 connector.
     * @constructor
     * @param {Worker} [worker=null] - Track the worker when using cluster
     */
    constructor(worker) {
        this.worker = worker;
        http.globalAgent.keepAlive = true;

        process.on('SIGINT', this.cleanUp.bind(this));
        process.on('SIGHUP', this.cleanUp.bind(this));
        process.on('SIGQUIT', this.cleanUp.bind(this));
        process.on('SIGTERM', this.cleanUp.bind(this));
        process.on('SIGPIPE', () => {});
        // This will pick up exceptions up the stack
        process.on('uncaughtException', err => {
            // If just send the error object results in empty
            // object on server log.
            logger.fatal('caught error', { error: err.message,
                stack: err.stack });
            this.caughtExceptionShutdown();
        });
    }

    /*
     * This starts the http server.
     */
    startup() {
        // Todo: http.globalAgent.maxSockets, http.globalAgent.maxFreeSockets
        if (_config.https) {
            this.server = https.createServer({
                cert: _config.https.cert,
                key: _config.https.key,
                ca: _config.https.ca,
                ciphers: arsenal.https.ciphers.ciphers,
                dhparam: arsenal.https.dhparam.dhparam,
                rejectUnauthorized: true,
            }, (req, res) => {
                // disable nagle algorithm
                req.socket.setNoDelay();
                routes(req, res, logger);
            });
            logger.info('Https server configuration', {
                https: true,
            });
        } else {
            this.server = http.createServer((req, res) => {
                // disable nagle algorithm
                req.socket.setNoDelay();
                routes(req, res, logger);
            });
            this.server.on('connection', (socket) => {
                console.log("connected!!")
            });
            logger.info('Http server configuration', {
                https: false,
            });
        }
        this.server.on('listening', () => {
            const addr = this.server.address() || {
                address: '0.0.0.0',
                port: _config.port,
            };
            logger.info('server started', { address: addr.address,
                port: addr.port, pid: process.pid });
        });
        this.server.listen(_config.port);
    }

    /*
     * This exits the running process properly.
     */
    cleanUp() {
        logger.info('server shutting down');
        this.server.close();
        process.exit(0);
    }

    caughtExceptionShutdown() {
        logger.error('shutdown of worker due to exception');
        // Will close all servers, cause disconnect event on master and kill
        // worker process with 'SIGTERM'.
        this.worker.kill();
        const killTimer = setTimeout(() => {
            if (!this.worker.isDead()) {
                this.worker.kill('SIGKILL');
            }
        }, 2000);
        killTimer.unref();
    }

    initiateStartup(log) {
        clientCheck(log, (err, results) => {
            if (err) {
                log.warn('initial health check failed, delaying startup', {
                    error: err,
                    healthStatus: results,
                });
                setTimeout(() => this.initiateStartup(log), 2000);
            } else {
                log.info('initial health check succeeded', {
                    healthStatus: results,
                });
                this.startup();
            }
        });
    }
}

export default function main() {
    let clusters = _config.clusters || 1;
    if (process.env.S3BACKEND === 'mem') {
        clusters = 1;
    }
    if (cluster.isMaster) {
        for (let n = 0; n < clusters; n++) {
            cluster.fork();
        }
        setInterval(() => {
            const len = Object.keys(cluster.workers).length;
            if (len < clusters) {
                for (let i = len; i < clusters; i++) {
                    const newWorker = cluster.fork();
                    logger.error('new worker forked',
                    { workerId: newWorker.id });
                }
            }
        }, 1000);
        cluster.on('disconnect', worker => {
            logger.error('worker disconnected. making sure exits',
                { workerId: worker.id });
            setTimeout(() => {
                if (!worker.isDead()) {
                    logger.error('worker not exiting. killing it');
                    worker.process.kill('SIGKILL');
                }
            }, 2000);
        });
        cluster.on('exit', worker => {
            logger.error('worker exited.',
                { workerId: worker.id });
        });
    } else {
        const server = new S3Server(cluster.worker);
        server.initiateStartup(logger.newRequestLogger());
    }
}
