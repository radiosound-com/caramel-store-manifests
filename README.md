# Caramel Store Kubernetes deployment

This repository contains the small, non-HA Kubernetes deployment for the
Caramel Store catalog API and its static catalog UI. The scanner remains on
littleboy outside Kubernetes. No signing key, import token, or APK is part of
this repository.

The application source now lives in the separate
[caramel-store-api](https://github.com/radiosound-com/caramel-store-api)
repository. This repository should contain deployment resources only.

The signed first-party repository source and release tooling live in
[caramel-app-repository](https://github.com/radiosound-com/caramel-app-repository).
Its generated static files are published to a dedicated Ceph RGW bucket. This
manifests repository contains only the credential-free HTTPS read gateway; it
contains no APKs, publisher credentials, or release-signing keys.

The UI source lives in
[caramel-store-ui](https://github.com/radiosound-com/caramel-store-ui). The
small static asset set is copied into `ui/` here so `kubectl apply -k .` is a
self-contained, reproducible deployment. The UI reads only public catalog GET
endpoints and never contains import controls or credentials.

The MVP import policy is network-public but application-authenticated: the
`/v1/import` Route is reachable through the public hostname, while the API
requires the scoped `Authorization: Bearer` token. This is intentionally a
simple first boundary; rate limiting and stronger edge authentication can be
added later.

The planned public hostname is
`caramel-vanilla-store.apps.radiosound.com`. The `*.apps` zone is protected by
Cloudflare, so the import protocol must not depend on one request carrying more
than 100 MB.

The root Route serves the UI. The longer `/v1/catalog` paths are handled by the
API Routes on the same hostname, keeping browser requests same-origin and
avoiding CORS. `/v1/import` remains a separate bearer-authenticated API Route;
the UI does not reference it. The longer `/fdroid/repo` Route serves the
F-Droid-compatible and Caramel-pinned repository indexes and immutable APK
objects from RGW on the same HTTPS hostname.

The scanner should produce a signed and validated import bundle outside the
cluster. The cluster side should accept only a scoped upload, validate the
bundle again, import it atomically into the catalog, and serve public catalog
reads separately from the import endpoint.

## Apply

This expects an OpenShift/OKD cluster with the `rook-ceph-block` StorageClass,
the standard OpenShift ingress and monitoring namespace labels, and a Rook
CephObjectStore. Review every platform-specific value before applying:

Create the two runtime Secrets out-of-band first, then apply the resources:

```sh
kubectl -n caramel-store create secret generic caramel-store-catalog-verification-key \
  --from-file=catalog-public.pem=/secure/path/catalog-public.pem
kubectl -n caramel-store create secret generic caramel-store-import-token \
  --from-file=import-token=/secure/path/import-token
kubectl apply -k .
```

The kustomization deploys the API, UI, and read-only app-repository Services
and Routes; the API Deployment; static Nginx UI and repository-gateway
Deployments; health probes; resource limits; and their NetworkPolicies. UI or
gateway configuration changes should be followed by a Deployment restart so
Nginx reloads the updated ConfigMap:

```sh
kubectl -n caramel-store rollout restart deployment/caramel-store-ui
kubectl -n caramel-store rollout restart deployment/caramel-app-repository
```

Do not commit the generated Secret YAML or the source files. Keep the source
values in the approved external password manager and use Kubernetes Secrets as
runtime copies.

`50-object-store-user.yaml` is the optional, narrowly scoped RGW publisher and
is intentionally not in the default kustomization. Its generated credential
stays in the storage-operator namespace and is used only by the controlled
release workstation. Neither the API nor either Nginx Deployment receives it.
The gateway reaches only anonymous GET/HEAD objects below
`caramel-apps/fdroid/repo` over the internal RGW service.

The checked-in router/node `ipBlock` entries are production-cluster-specific
because this OKD router uses host networking. DNS egress includes OpenShift's
translated pod port 5353 as well as service port 53. Revalidate these values
before applying the manifests to another cluster.

## First-party repository route

Production reads are available at:

```text
https://caramel-vanilla-store.apps.radiosound.com/fdroid/repo/
```

The route supports byte ranges for large APK downloads, verifies the OpenShift
service CA when proxying to RGW, disables request/response buffering, and does
not permit bucket listing. APK objects are immutable and versioned; repository
indexes and screenshots use short revalidation caching. Build and publication
commands are documented in the separate repository source. Publication is a
release operation and is not performed by `kubectl apply -k .`.

## Route and upload contract

Use `60-route-public.example.yaml` as the public catalog Route after the API
Deployment has endpoints. Public catalog reads may use the planned hostname;
the staging/import endpoint must remain separately protected by VPN, mTLS, or
an equivalent access policy even when it shares that hostname.

The import Route is intentionally public but requires the scoped bearer token;
it must not be treated as anonymous just because it is reachable through the
public hostname. Bundles larger than 100 MB must use a resumable, chunked
upload protocol. The scanner and importer should agree on an upload-session
identifier, bounded chunk size, per-chunk SHA-256, final bundle SHA-256,
ordered assembly, retry, and cleanup of abandoned sessions. Signature and
schema validation happen on the completed bundle before the atomic catalog
import.

The API's Prometheus endpoint exposes import attempts, rejections, failures,
payload/signature byte counters, publish counts, active catalog entry count,
active revision, and catalog file sizes. Keep the existing `ServiceMonitor`
enabled and alert on rejected/failed imports; graph the byte counters and
revision information to observe scanner and catalog changes.

## Foundation posture

- Namespace Pod Security enforcement is `restricted`.
- ResourceQuota allows at most 750m CPU requests and 2 CPU limits.
- LimitRange defaults new containers to 50m CPU and 128Mi memory requests.
- No default CPU limit is imposed, avoiding accidental throttling.
- Catalog data uses a 20 GiB ReadWriteOnce PVC.
- All traffic is denied by default; ingress, monitoring, and DNS are explicit.
- The Service and Routes use the pinned API image and the planned public host.
- The object-store identity is not a release-signing identity.
- The UI requests 10m CPU/32Mi memory and is limited to 100m CPU/128Mi memory.
- The UI Nginx health endpoint is `/healthz`; static assets are cacheable for
  five minutes and the HTML shell is revalidated.
- The repository gateway has the same 10m/32Mi request and 100m/128Mi limit,
  verifies its RGW upstream certificate, and contains no object-store secret.

## Caramel Vanilla image trial site

The separate `ota-site/` kustomization publishes the developer/DIY image
download page at `https://caramel-vanilla.apps.radiosound.com`. The page and its
captured media are packaged as an immutable nginx image and published to the
public GitHub Container Registry image
`ghcr.io/radiosound-com/caramel-vanilla-ota-site`. GitHub Actions builds it from
`ota-site/Dockerfile`; the Kubernetes deployment pulls the `main` image tag
while this trial site is iterated. Promote a tested digest before treating the
site as production infrastructure.

The large image payloads and machine-readable alpha channel manifest are
published to the existing Rook Ceph RGW update origin and read through:

```text
https://mrdata.apps.radiosound.com/channels/caramel-vanilla/alpha/
```

The current Raspberry Pi 5 alpha images use a physical A/B layout with a
partition-preserving update path and rollback metadata. The update engine,
boot-control integration, and recovery behavior remain experimental; keep a
known-good image available and do not treat the trial as an unattended in-car
update system.

## Next implementation steps

1. Define the signed import-bundle schema: signature, freshness, provenance,
   checksums, package policy, idempotency key, and chunked-upload metadata.
2. Build the external scanner uploader with retry, bounded rate, resumable
   chunks, and no Kubernetes or database credentials.
3. Run the signed/invalid/stale/restart acceptance tests through the public
   routes, then verify that the periodic full-cluster backup includes the
   `caramel-store` namespace, its Secrets, and the `catalog-data` PVC; perform
   a restore test through the cluster backup agent rather than creating an
   application-specific backup schedule here.
4. Add the scoped object-store Secret only if the API later needs artifact
   storage.
5. Review scheduled first-party upstream-update issues and publish only after
   package-specific Automotive tests pass.
