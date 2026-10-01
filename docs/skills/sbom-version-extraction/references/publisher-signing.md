# Publisher signing of SPDX referrers

`oras discover` is an unsigned registry listing: any writer to the repository
can attach a referrer, and the provenance check binds the image digest only.
The signature check holds the artifact to the same `certificateIdentityRegexp`
and `certificateOidcIssuer` policy as the image.

## Publisher signing status (checked 2026-10-01)

While publishers transition to signing SPDX referrers, `collectVerifiedImageSbom`
operates structurally in warn-only mode: if `sbomReferrer.referrers` is empty
(as checked live on `ublue-os/bluefin:stable`), it records `sbomSignature: 'missing'`
without failing the build. When nested referrers exist (as on `projectbluefin/dakota:stable`),
`cosign verify` validates the signature against the publisher policy.

Verified live with cosign v3.1.3 / oras v1.2.0 against GHCR:

- Every registered image carries exactly one
  `application/vnd.dev.sigstore.bundle.v0.3+json` referrer next to the
  `application/vnd.spdx+json` one. That bundle is the **image's provenance
  attestation**, not a signature on the SBOM: its DSSE payload is
  `https://slsa.dev/provenance/v1` and its subject is the *image* digest —
  checked on `ublue-os/bluefin`, `ublue-os/bluefin-dx`,
  `ublue-os/bluefin-nvidia-open`, `projectbluefin/dakota`, and
  `projectbluefin/dakota-nvidia`.
- `cosign verify-attestation --type spdxjson` finds no spdxjson attestation
  ("none of the attestations matched the predicate type: spdxjson, found:
  https://slsa.dev/provenance/v1").
- `cosign verify` against `<repository>@<sbomDigest>` on `projectbluefin/dakota`
  verifies offline claims in the transparency log, matching the nested
  referrer in its discovery listing. On `ublue-os/bluefin:stable`, discovery
  lists empty `referrers: []`, and direct verification yields:
  `no matching signatures: error verifying bundle: empty key`.

To make the check pass across all publishers, publishers sign the referrer manifest directly:
```bash
cosign sign <repository>@<sbomDigest>
```
This puts a verifiable signature on the referrer manifest itself, verified
with `cosign verify`.
