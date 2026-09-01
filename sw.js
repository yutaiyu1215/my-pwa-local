const CACHE_NAME = "my-pwa-local-v2";
const APP_SHELL = "./index.html";

self.addEventListener("install", event => {
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();

        await Promise.all(
            keys
                .filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
        );

        await self.clients.claim();
    })());
});

function normalizeUrl(input) {
    try {
        const url = new URL(
            input,
            self.location.href
        );

        return url.href;
    } catch {
        return input;
    }
}

async function fetchAndCache(cache, input) {
    const url = normalizeUrl(input);

    const request = new Request(
        url,
        {
            cache: "reload"
        }
    );

    const response = await fetch(request);

    if (
        !response.ok &&
        response.type !== "opaque"
    ) {
        throw new Error(
            `${response.status} ${url}`
        );
    }

    await cache.put(
        request,
        response.clone()
    );

    return url;
}

self.addEventListener("message", event => {
    const data = event.data || {};

    if (data.type !== "CACHE_ALL") {
        return;
    }

    const port =
        event.ports &&
        event.ports[0];

    if (!port) {
        return;
    }

    event.waitUntil((async () => {
        try {
            const cache =
                await caches.open(
                    CACHE_NAME
                );

            const seeds =
                Array.from(
                    new Set(
                        (data.seeds || [])
                            .map(normalizeUrl)
                    )
                );

            port.postMessage({
                type: "START",
                total: seeds.length
            });

            let done = 0;
            const failed = [];

            for (const item of seeds) {
                let ok = true;

                try {
                    await fetchAndCache(
                        cache,
                        item
                    );
                } catch (error) {
                    ok = false;

                    failed.push({
                        url: item,
                        message: String(error)
                    });
                }

                done += 1;

                port.postMessage({
                    type: "PROGRESS",
                    done,
                    total: seeds.length,
                    url: item,
                    ok
                });
            }

            port.postMessage({
                type: "DONE",
                failed
            });

        } catch (error) {
            port.postMessage({
                type: "ERROR",
                message: String(
                    error &&
                    error.message
                        ? error.message
                        : error
                )
            });
        }
    })());
});

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith((async () => {
            const cache =
                await caches.open(
                    CACHE_NAME
                );

            try {
                const network =
                    await fetch(request);

                if (
                    network &&
                    network.ok
                ) {
                    cache.put(
                        request,
                        network.clone()
                    );
                }

                return network;

            } catch {
                let cached =
                    await cache.match(
                        request,
                        {
                            ignoreSearch: true
                        }
                    );

                if (cached) {
                    return cached;
                }

                const url =
                    new URL(
                        request.url
                    );

                url.search = "";

                cached =
                    await cache.match(
                        url.href,
                        {
                            ignoreSearch: true
                        }
                    );

                if (cached) {
                    return cached;
                }

                const shell =
                    await cache.match(
                        APP_SHELL
                    );

                if (shell) {
                    return shell;
                }

                return new Response(
                    "Offline",
                    {
                        status: 503,
                        headers: {
                            "Content-Type":
                                "text/plain; charset=utf-8"
                        }
                    }
                );
            }
        })());

        return;
    }

    event.respondWith((async () => {
        const cache =
            await caches.open(
                CACHE_NAME
            );

        const cached =
            await cache.match(
                request,
                {
                    ignoreSearch: false
                }
            );

        if (cached) {
            return cached;
        }

        try {
            const network =
                await fetch(request);

            if (
                network &&
                (
                    network.ok ||
                    network.type === "opaque"
                )
            ) {
                cache.put(
                    request,
                    network.clone()
                );
            }

            return network;

        } catch {
            const fallback =
                await cache.match(
                    request,
                    {
                        ignoreSearch: true
                    }
                );

            if (fallback) {
                return fallback;
            }

            throw new Error(
                "Offline resource unavailable"
            );
        }
    })());
});
