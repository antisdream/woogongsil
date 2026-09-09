// Public certificates for deterministic tests. No private keys.
const certificates = {
  "approved-one": "-----BEGIN CERTIFICATE-----\nMIIC2jCCAcKgAwIBAgIUTAXkpamhj7IfZbkBU8DWp5tvuOQwDQYJKoZIhvcNAQEL\nBQAwEDEOMAwGA1UEAwwFcWEtY2EwHhcNMjYwMTAxMDAwMDAwWhcNMzAwMTAxMDAw\nMDAwWjAXMRUwEwYDVQQDDAxhcHByb3ZlZC1vbmUwggEiMA0GCSqGSIb3DQEBAQUA\nA4IBDwAwggEKAoIBAQC6F3SIysKWdzIrFb8sp87UY3ysznaMWDiETNBjX7bt0Vsk\n7ykYgsB2BrgQQwaTUDirR1xYyo3s8hebrCgzZcpgR2x1isGlv3arWg8vfOegVzQi\nJjmFjrINv7v5iorYFh5/GivYGPIeI6cbgWaCukSPRrzpJQrV3H8pwPf1xL3Bz97l\n4pTO9LSh0L60elc1m1ziWIn40dyQucdkKh8m25D6fSdNXt8gq2NZiayXqsDtseuO\nPSgTsWLfTFuKXzXxhqPEoWnGFhiBIEKRCQFkSqM5vK3ZsCnld1gs31IRAE208Efz\nVia17oNE0Qwxv5nYQlsma+OyRGSmCc9kRyfnVgDjAgMBAAGjJTAjMAwGA1UdEwEB\n/wQCMAAwEwYDVR0lBAwwCgYIKwYBBQUHAwIwDQYJKoZIhvcNAQELBQADggEBAJ1E\nIunZbr0T4fUQm2MIncSUfFFPyRP/njp1P6kQ0eV0j8xmTFhfjzGJsZMMzeaxa9He\nhx+HiwHNFWrmIrRsqR8qbXAD3I55kGRc/+71+0ddSJdtsyTtwxDELY5iDqHYYs8P\nSpbfQkHhTZFrIlxmRnHmuCULfzcmjI4o6m7cYye/o9TCHdPnaTHWRpiKAONVCcJF\nLbgLeRQJxB2Xqn1REUrQfp4dakZGQW2QdbKtDO10GYmDac0HmEUkBXRc9Hc2uFth\nkl6hk2XPjDdOGg2DXans3vAv2h6oJg6lxeb9U+ljQnR/rGf44yXr5GJUOTTkbcam\nLp/tc3RN8YvoZZaX2yg=\n-----END CERTIFICATE-----\n",
  "approved-two": "-----BEGIN CERTIFICATE-----\nMIIC2jCCAcKgAwIBAgIUcmmJHabIw1QLqRkPo3uv09IwC6AwDQYJKoZIhvcNAQEL\nBQAwEDEOMAwGA1UEAwwFcWEtY2EwHhcNMjYwMTAxMDAwMDAwWhcNMzAwMTAxMDAw\nMDAwWjAXMRUwEwYDVQQDDAxhcHByb3ZlZC10d28wggEiMA0GCSqGSIb3DQEBAQUA\nA4IBDwAwggEKAoIBAQDN4+WGTh+DoNpnBaOltpVHXBpptwM3rGKWOkZI37/Hvdgv\nhuelQD4YRoIQxxqdSebP1mYqJ0wQExNW71x4IIaLuk38WsKP4h5gb59MRTBOEGTI\nHMiCcznvGca4dFrKdC2qwxi8/w/pf7+fLdoO1nw7SEe8SOJmoBHIY03xDDoSft0H\nDCEpWElYbugzvIsHVzegCSvUUqOHNwolzD99h7QnMfOsMIM/nRCxnbdAOf/bwPvt\n7wQbVAVtZakHOQoWrJO3lAIU6QtFwCa3pO+M87io2A7mfDTt9KlADncRinKhr2sD\nS7nOSaeF+NeKS6GX4jUTaGb61UCJBwmJs1wx5GPxAgMBAAGjJTAjMAwGA1UdEwEB\n/wQCMAAwEwYDVR0lBAwwCgYIKwYBBQUHAwIwDQYJKoZIhvcNAQELBQADggEBAAHk\nESXCAdhy3Nf6+24DQIdGAsT0abb/F0T8bSEUT2qj4mMMVOemf2D+znd+RkQFLT4o\namlBv4J5ObhViVkIh7zOVK5VHjO8ZqGT+evJ6oCRzd4gf+mSXAvmD3TkbEkkZYTH\nof+ZnWtbGd95AasoCLP13bhZtWIt7zMPzaLwhd0/FvrYS6FUHjg+MffsZdpUMOtk\njWYMhft+vgCLK8B2RIYSMDWl+arZfzrLfayenifA6vGdw5yJRfuEDMaRnCdTuf3W\nJJRozLeIqpofX3kx5HrVZQlMP/ch/4PgBkmpDd0mWMLsq9beVt0s7/gtpSsT9dm4\nFk9Hwtl1uHAnx+bBu1Y=\n-----END CERTIFICATE-----\n",
  "unapproved": "-----BEGIN CERTIFICATE-----\nMIIC2DCCAcCgAwIBAgIUMI685p+s5wTZvd338ylS9wWJszYwDQYJKoZIhvcNAQEL\nBQAwEDEOMAwGA1UEAwwFcWEtY2EwHhcNMjYwMTAxMDAwMDAwWhcNMzAwMTAxMDAw\nMDAwWjAVMRMwEQYDVQQDDAp1bmFwcHJvdmVkMIIBIjANBgkqhkiG9w0BAQEFAAOC\nAQ8AMIIBCgKCAQEAr7UsY1pAgvWTwpEF+toRYSitovgfbq7msqBcxPf7syonfRiZ\ntEWxFUYf5x26K1TUN6h8faCv/ZnhNxq/8jkOZqICZ13xChXnVjVv3/yrBu+4s2Qk\n/mm71uElxCFVcyxHh2EIWAsjoQ44GBJpE6rWCdxLgX+9IISgjduE8+xnR7Df6gpo\nNm2aJJfJtF8dOPmhdM5vQPmA1a+GxZSLc8FrGuoBs1c7vK+Rbtg1leHBlrfiB7tE\nBDsqTDOeYDlGsCl4RGn7jyoG8BuxF7rSgxORlE+wWZOW6nbWKgc4YDe5u5xFGM4L\n9bqjKRjb2+UjtselOPRHMWT9m2NsT/soOuJIMwIDAQABoyUwIzAMBgNVHRMBAf8E\nAjAAMBMGA1UdJQQMMAoGCCsGAQUFBwMCMA0GCSqGSIb3DQEBCwUAA4IBAQCBIBL/\niVzLoxFJ9p8H5CWz8yGsjTxbvgHvXafw4tif1r0OdnFen9EzF76h4PTJVM7wBuZK\ns55F4B9+8Hk1rVNdbhq0SFn4KJROpAaLEccXqeoJeptz6QpXv/gEQUzqL1vDvJ7T\n7LHXrU1U1mRmaJkCnrxbM5DWCcMNl/qe1FYSZYedCIqFaNJUNfLRtRsz0CEQRfU5\njTh/RVxRd5oP9mqKJum9cdZL6OgvErQOmxv72VVjXL5KRdvwlAFvlX/0wBTnYG+F\n8HmhT8+OHpgFC8sESn2qxfK1RCgzU37wbK7pO0wad7ayJCrfmYxWTWYxkxORq4/O\nbeGPKS/VUBh5stXe\n-----END CERTIFICATE-----\n"
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { createAdminDeviceAccess, protectedAdminPath, parsePolicy } = require('./services/adminDeviceAccess');
const fingerprint = (name) => new X509Certificate(certificates[name]).fingerprint256.replace(/:/g, '').toLowerCase();
const policy = () => ({ version: 1, gatewaySecret: '1'.repeat(64), devices: [
    { sha256: fingerprint('approved-one') }, { sha256: fingerprint('approved-two') },
] });
const request = (name = 'approved-one', overrides = {}) => ({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-wgs-admin-gateway': '1'.repeat(64), 'x-wgs-admin-verify': 'SUCCESS',
        'x-wgs-admin-certificate': encodeURIComponent(certificates[name]), ...overrides },
});
const create = (options = {}) => createAdminDeviceAccess({ readPolicy: policy, now: () => Date.parse('2027-01-01'), ...options });

test('device gate protects admin HTML, API, encoded and case aliases', () => {
    for (const value of ['/manage', '/manage/', '/manage/index.html', '/manage/dashboard', '/api/admin', '/api/admin/auth/login',
        '/MANAGE/', '/api/ADMIN/auth/login', '/man%61ge/index.html', '/manage%2findex.html', '/x/../manage/', '/x/..%5cmanage/index.html', '/%zz']) {
        assert.equal(protectedAdminPath(value), true, value);
    }
    for (const value of ['/', '/login', '/fortune', '/api/visitors/summary', '/api/administer', '/management']) {
        assert.equal(protectedAdminPath(value), false, value);
    }
});

test('exactly two distinct pinned certificates are required', () => {
    assert.equal(parsePolicy(policy()).fingerprints.size, 2);
    for (const value of [null, {}, { ...policy(), devices: [] }, { ...policy(), devices: [policy().devices[0], policy().devices[0]] },
        { ...policy(), gatewaySecret: '' }, { ...policy(), devices: [...policy().devices, { sha256: fingerprint('unapproved') }] }]) {
        assert.throws(() => parsePolicy(value));
    }
});

test('both approved certificates pass; another valid certificate is rejected', () => {
    const service = create();
    for (const name of ['approved-one', 'approved-two']) assert.equal(service.authenticate(request(name)).fingerprint, fingerprint(name));
    assert.equal(service.authenticate(request('unapproved')), null);
});

test('missing, forged and unverified proxy credentials fail closed', () => {
    const service = create();
    for (const headers of [
        { 'x-wgs-admin-gateway': '' }, { 'x-wgs-admin-gateway': '2'.repeat(64) },
        { 'x-wgs-admin-verify': 'NONE' }, { 'x-wgs-admin-verify': 'FAILED:untrusted' },
        { 'x-wgs-admin-certificate': '' }, { 'x-wgs-admin-certificate': '%invalid' },
        { 'x-wgs-admin-certificate': 'x'.repeat(12001) },
    ]) assert.equal(service.authenticate(request('approved-one', headers)), null);
    assert.equal(service.authenticate({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), null);
    assert.equal(service.authenticate({ ...request(), socket: { remoteAddress: '198.51.100.10' } }), null);
});

test('expired, not-yet-valid and removed approvals fail immediately', () => {
    assert.equal(create({ now: () => Date.parse('2031-01-01') }).authenticate(request()), null);
    assert.equal(create({ now: () => Date.parse('2025-01-01') }).authenticate(request()), null);
    let current = policy();
    const service = create({ readPolicy: () => current });
    assert.ok(service.authenticate(request()));
    current = { ...policy(), devices: [{ sha256: fingerprint('unapproved') }, policy().devices[1]] };
    assert.equal(service.authenticate(request()), null);
    current = null;
    assert.equal(service.authenticate(request()), null);
    assert.equal(create({ readPolicy: () => { throw new Error('missing file'); } }).authenticate(request()), null);
});

test('unapproved page access returns no administrator HTML; public pages continue', () => {
    const service = create();
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code=code; return this; },
        type(value) { this.contentType=value; return this; }, send(value) { this.body=value; return this; } };
    let next = 0;
    service.protect({ originalUrl: '/manage/index.html', headers: {} }, res, () => { next += 1; });
    assert.equal(res.code, 404); assert.equal(res.body, 'Not Found'); assert.equal(next, 0);
    assert.match(res.headers['Cache-Control'], /no-store/);
    service.protect({ originalUrl: '/', headers: {} }, res, () => { next += 1; });
    const approved = { originalUrl: '/manage/', ...request() };
    service.protect(approved, res, () => { next += 1; });
    assert.equal(next, 2); assert.ok(approved.adminDevice);
    assert.equal(approved.headers['x-wgs-admin-gateway'], undefined);
    const publicRequest = { originalUrl: '/api/visitors/summary', ...request() };
    publicRequest.rawHeaders = ['Host','localhost','X-WGS-Admin-Gateway','1'.repeat(64),'X-WGS-Admin-Certificate','private-header'];
    service.protect(publicRequest, res, () => { next += 1; });
    assert.ok(publicRequest.adminDevice);
    assert.equal(publicRequest.headers['x-wgs-admin-gateway'], undefined);
    assert.equal(publicRequest.headers['x-wgs-admin-certificate'], undefined);
    assert.deepEqual(publicRequest.rawHeaders, ['Host','localhost']);
});
