# server/test/unit

| File | What it covers |
|---|---|
| [app.test.ts](app.test.ts) | Every route: validation errors, spawn success and failure, 409 / 429 / 503 caps, no key material in any response, resume and retire |
| [settings.test.ts](settings.test.ts) | Env parsing, defaults per network and rejected values |
| [store.test.ts](store.test.ts) | Key file round trip with mode 0600, retired file, other-deployment file set aside |
| [helpers.ts](helpers.ts) | `FakeChain`, `FakeRuntime` and the app harness |

- To find the code under test visit [../../src/](../../src/README.md).
