# Caramel Store Kubernetes foundation

This repository contains the small, non-HA Kubernetes foundation for the
Caramel Store catalog service. It deliberately does not deploy the scanner,
the catalog API image, a public Route, or a release-signing service.

The application source now lives in the separate
[caramel-store-api](https://github.com/radiosound-com/caramel-store-api)
repository. This repository should contain deployment resources only.

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

```sh
kubectl apply -k .
```

Before applying `50-object-store-user.yaml`, set `spec.store` to the name of
an existing `CephObjectStore`. Create the selected-artifact bucket and its
read/publish policy as a separate controlled step. Copy only the required
object-store credential into the application namespace when the application
deployment is ready.

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
- The Service is internal until an API image and route contract exist.
- The object-store identity is not a release-signing identity.

## Next implementation steps

1. Build and publish the [catalog API](https://github.com/radiosound-com/caramel-store-api)
   image with a restricted-compatible container, HTTP port 8080, health
   endpoints, optional metrics on 9090, and an atomic SQLite import transaction.
2. Define the signed import-bundle schema: signature, freshness, provenance,
   checksums, package policy, idempotency key, and chunked-upload metadata.
3. Build the external scanner uploader with retry, bounded rate, resumable
   chunks, and no Kubernetes or database credentials.
4. Keep public catalog reads and authenticated/VPN-protected imports on
   separate Routes or equivalent ingress policies.
5. Add the Deployment, ServiceMonitor, routes, scoped object-store Secret,
   backup job, and restore test after the API contract is fixed.
6. Publish a signed filtered catalog/index and document upstream F-Droid
   links, selected mirrors, Aurora as an optional source, and compatibility
   review results.
