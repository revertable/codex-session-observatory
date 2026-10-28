# Code signing policy

**Status: Draft for SignPath Foundation application. Code signing is not enabled.**

Subject to SignPath Foundation approval and completion of the signing setup, the planned attribution is: Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Signing scope

This policy covers `codex-session-observatory.exe`, the Windows executable of Codex Session Observatory, distributed in portable ZIP packages through the project's [GitHub Releases](https://github.com/revertable/codex-session-observatory/releases).

Once signing is enabled:

- Only this project's executable built from the [public source repository](https://github.com/revertable/codex-session-observatory) will be submitted for signing.
- Release binaries will be built through a verifiable automated process tied to an identified source commit and release tag. The signing service must be able to verify their build origin.
- Each signing request will require manual approval. The approver will check the source revision, release changes, build results, and artifacts before approval.
- Product name and version metadata will be checked and enforced in the signing configuration.
- Third-party binaries will not be signed using the project's SignPath subscription.

The current CI workflow performs automated verification; it does not package releases or submit signing requests. The release build and signing integration must be configured and verified before signed releases are published.

Existing releases remain unsigned unless explicitly identified as signed. Release notes for signed releases will identify the signed artifact and its source revision. The ZIP container is a distribution package; the executable inside it is the signing target.

## Team roles

I develop and maintain Codex Session Observatory independently as [revertable](https://github.com/revertable).

| Role | Member | Responsibility |
| --- | --- | --- |
| Author / Committer | [revertable](https://github.com/revertable) | Maintains the source code and build scripts and may integrate changes without an additional reviewer. |
| Reviewer | [revertable](https://github.com/revertable) | Reviews external contributions before integration, including changes to build and signing configuration. |
| Approver | [revertable](https://github.com/revertable) | Reviews and manually approves each release signing request. |

Before signing is enabled, all team members must use multi-factor authentication for both GitHub and SignPath access. These roles are currently held by one maintainer.

## Privacy policy

### Local session processing

Codex Session Observatory reads and processes local Codex session records on the user's device. It does not upload session contents to a remote service. Transcript capture and Collection copy text to the clipboard on request; Worklog export writes files locally on request. The original session records are not rewritten.

### Startup release check

At startup, the current application automatically makes an unauthenticated HTTPS request to `https://api.github.com/repos/revertable/codex-session-observatory/releases/latest` to compare the installed version with the latest public release. It does not download or install updates.

The request does not include session contents, selected file paths, or session identifiers. GitHub receives connection and HTTP request information, including the public IP address and request metadata, under the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The application compares versions locally.

The current application has no in-app setting to disable this automatic request. Applicability of the Foundation's privacy notice and disabling requirements to this behavior must be resolved before signing is enabled; this policy describes the current behavior rather than claiming those controls are implemented.

### External links and runtime

External links open in the user's browser only through explicit user actions. The destination service's privacy policy applies when visiting it. The Cosmic Horizon Archive link includes fixed campaign parameters identifying the application as the referral source; they do not include session data.

The application uses the Microsoft Edge WebView2 runtime installed on Windows. Microsoft's handling of runtime data is described in the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

## Verifying a signed release

For a release explicitly marked as signed, extract the portable ZIP and check the executable in Windows **Properties → Digital Signatures**, or run:

```powershell
Get-AuthenticodeSignature .\codex-session-observatory.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
```

A signed release must report `Valid`. With the planned Foundation signing service, the certificate is issued to SignPath Foundation. Check the release notes for the applicable signing status and source revision.

See the [README](../README.md) for application behavior and distribution details, and the [SignPath Foundation conditions](https://signpath.org/terms) for the program's requirements.
