# OpenID test keys

For tests only. These are throwaway RSA-2048 key pairs that the ID token checks
of Sign in with ChatGPT are tested with: the tests sign tokens with the private
halves and check them against the published halves, standing in for OpenAI's
keys. They protect nothing and are not used by the app.

- `key-a.pkcs1.der`, `key-b.pkcs1.der`: private keys, PKCS#1 DER.
- `jwks-a.json`, `jwks-b.json`: the public key of each, as OpenAI publishes its
  own (`kid` `test-key-a` and `test-key-b`).
- `jwks-ab.json`: both, for a key set that is rotated.

They were made once with Node's crypto (`generateKeyPairSync('rsa',
{modulusLength: 2048})`). Tests read them from these files, so replacing them
is safe.
