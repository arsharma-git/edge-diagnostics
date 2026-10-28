const geoip = require('geoip-lite');

function lookup(ip) {
  const geo = geoip.lookup(ip);
  return geo || { error: 'not found' };
}

function enrichLocation(ip) {
  const geo = lookup(ip);
  if (geo && !geo.error) {
    return {
      city: geo.city,
      country: geo.country,
      ll: geo.ll,
      timezone: geo.timezone
    };
  }
  return null;
}

module.exports = {
  lookup,
  enrichLocation
};
