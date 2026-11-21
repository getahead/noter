# Research status

This is an executable experiment related to #998, not a production remediation. It investigates the file-access boundary described by `core-first-run` D14 and `core-engine-foundation` E1. It changes no FEATURE acceptance, D14/C18 storage policy, engine entitlement, frozen protocol, harness gate or screenshot baseline.

The original local package compiled on Apple Silicon with Swift 6.4 and passed nine Python tests, 22 Swift protocol assertions and deep strict codesign verification. The host has no entitlements; the child has only App Sandbox enabled. Those checks are preparation evidence, not proof that bookmark handoff works.

An operator reported the `none` case passing on macOS27.2/build26B123 using a separately rebuilt test artifact. That run was in the operator's regular account, not a disposable session, and the synthetic fixture was then removed with the guarded cleanup command. Treat it as a preliminary negative control only. The implicit/stripped/corrupt/cancellation matrix remains unvalidated, as do old-group access and real Noter model/capture acceptance.

Docker Desktop on the development Mac reports a Linux/arm64 server with a LinuxKit kernel. Linux containers cannot exercise this AppKit/App Sandbox experiment. A macOS GUI VM is the required VM alternative; Docker's Linux VM does not supply that environment. See [Docker platform documentation](https://docs.docker.com/faqs/platform/) and [Apple's macOS virtualization sample](https://developer.apple.com/documentation/virtualization/running-macos-in-a-virtual-machine-on-apple-silicon).

Keep #998 open. Run only the documented bounded spike after authorizing/providing the disposable macOS runtime. A passing storage experiment would still require separate product design, regression tests, data-preserving implementation and release acceptance.
