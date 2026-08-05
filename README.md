# Caramel Store Kubernetes foundation

This repository contains the small, non-HA Kubernetes foundation for the
Caramel Store catalog service. It deliberately does not deploy the scanner,
the catalog API image, a public Route, or a release-signing service.

The application source now lives in the separate
[caramel-store-api](https://github.com/radiosound-com/caramel-store-api)
repository. This repository should contain deployment resources only.

The MVP import policy is network-public but application-authenticated: the
`/v1/import` Route is reachable through the public hostname, while the API
requires the scoped `Authorization: Bearer` token. This is intentionally a
simple first boundary; rate limiting and stronger edge authentication can be
added later.

The planned public hostname is
`caramel-vanilla-store.apps.radiosound.com`. The `*.apps` zone is protected by
Cloudflare, so the import protocol must not depend on one request carrying more
than 100 MB.

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
