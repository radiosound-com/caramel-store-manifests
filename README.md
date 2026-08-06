# Caramel Store Kubernetes deployment

This repository contains the small, non-HA Kubernetes deployment for the
Caramel Store catalog API and its static catalog UI. The scanner remains on
littleboy outside Kubernetes. No signing key, import token, or APK is part of
this repository.

The application source now lives in the separate
[caramel-store-api](https://github.com/radiosound-com/caramel-store-api)
repository. This repository should contain deployment resources only.

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
the UI does not reference it.

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

The kustomization deploys the API and UI Services, the API and UI Routes, the
API Deployment, the static Nginx UI Deployment, health probes, resource limits,
and the UI router NetworkPolicy. UI asset changes should be followed by a
Deployment restart so Nginx reloads the updated ConfigMap:

```sh
kubectl -n caramel-store rollout restart deployment/caramel-store-ui
```

Do not commit the generated Secret YAML or the source files. Keep the source
values in the approved external password manager and use Kubernetes Secrets as
runtime copies.

`50-object-store-user.yaml` is an optional example and is intentionally not in
the default kustomization. If the API later needs artifact storage, set
`spec.store` to the name of an existing `CephObjectStore`, create the
selected-artifact bucket and its read/publish policy as a separate controlled
step, and copy only the required object-store credential into the application
namespace.

The network policy intentionally contains no site-specific node or router IP
addresses. Add a local `ipBlock` only when the target platform requires it for
host-networked ingress.

## Route and upload contract

Use `60-route-public.example.yaml` as the public catalog Route after the API
Deployment has endpoints. Public catalog reads may use the planned hostname;
the staging/import endpoint must remain separately protected by VPN, mTLS, or
an equivalent access policy even when it shares that hostname.

Bundles larger than 100 MB must use a resumable, chunked upload protocol. The
scanner and importer should agree on an upload-session identifier, bounded
chunk size, per-chunk SHA-256, final bundle SHA-256, ordered assembly, retry,
and cleanup of abandoned sessions. Signature and schema validation happen on
the completed bundle before the atomic catalog import.

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

## Next implementation steps

1. Define the signed import-bundle schema: signature, freshness, provenance,
   checksums, package policy, idempotency key, and chunked-upload metadata.
2. Build the external scanner uploader with retry, bounded rate, resumable
   chunks, and no Kubernetes or database credentials.
3. Run the signed/invalid/stale/restart acceptance tests through the public
   routes, then add the catalog backup job and restore test.
4. Add the scoped object-store Secret only if the API later needs artifact
   storage.
5. Publish a signed filtered catalog/index and document upstream F-Droid
   links, selected mirrors, Aurora as an optional source, and compatibility
   review results.
