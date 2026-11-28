// Passenger startup file for cPanel. Copied to the top level of the standalone
// deploy folder, next to Next's generated server.js.
//
// server.js boots under Passenger, but Next builds every absolute URL from
// HOSTNAME:PORT (http://0.0.0.0:3000), not from the request. Passenger listens
// on its own socket and ignores both, so request.url / nextUrl.origin would send
// the email-confirm, OAuth and Paystack callback redirects to a dead address.
// Telling Next the public host and port fixes that.
const http = require('http')

const origin = new URL(process.env.APP_ORIGIN || 'https://sentinelxesports.com.ng')

process.env.HOSTNAME = origin.hostname
process.env.PORT = origin.port || '443'

const emit = http.Server.prototype.emit
http.Server.prototype.emit = function (event, req) {
  if (event === 'request') {
    // The site is HTTPS-only, but Apache doesn't always say so.
    req.headers['x-forwarded-proto'] = 'https'
    // Next calls itself on this origin to render server-action redirects, and
    // sets it to http://<host>:443 once it is listening. Correct it.
    process.env.__NEXT_PRIVATE_ORIGIN = origin.origin
  }
  return emit.apply(this, arguments)
}

require('./server.js')
