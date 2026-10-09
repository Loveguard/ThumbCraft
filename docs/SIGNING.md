# Signing the Windows builds

Unsigned Windows programs make SmartScreen show _"Windows protected your PC"_ the first time someone runs them.
The release workflow signs the installer and the portable .exe with **Azure Trusted Signing** (Microsoft's
code-signing service, now also called Artifact Signing) as soon as the settings below exist. Until then builds stay
unsigned and everything else works the same.

## One-time setup

1. In the [Azure portal](https://portal.azure.com), create a **Trusted Signing account** (the Basic plan is a
   small monthly fee) and complete **identity validation** for yourself or your organisation. Check Microsoft's
   Trusted Signing documentation for who is currently eligible.
2. In that account, create a **certificate profile** of type **Public Trust**.
3. In **Microsoft Entra ID → App registrations**, register an app and give it a **client secret**.
4. On the Trusted Signing account, assign that app the role **Trusted Signing Certificate Profile Signer**.
5. In the ThumbCraft repository on GitHub, **Settings → Secrets and variables → Actions**, add:

   | Secrets               | Value                                  |
   | --------------------- | -------------------------------------- |
   | `AZURE_TENANT_ID`     | The directory (tenant) ID of the app   |
   | `AZURE_CLIENT_ID`     | The application (client) ID of the app |
   | `AZURE_CLIENT_SECRET` | The client secret's value              |

   | Variables        | Value                                                                 |
   | ---------------- | --------------------------------------------------------------------- |
   | `SIGN_PUBLISHER` | The publisher name exactly as on the certificate (the validated name) |
   | `SIGN_ENDPOINT`  | The account's endpoint, e.g. `https://eus.codesigning.azure.net/`     |
   | `SIGN_ACCOUNT`   | The Trusted Signing account name                                      |
   | `SIGN_PROFILE`   | The certificate profile name                                          |

The next release is signed. SmartScreen also weighs a program's reputation, so a newly signed app can still show
the warning for a while; it goes away as people download and run signed releases.

Open-source projects can also apply to [SignPath Foundation](https://signpath.org) for free signing; that needs a
different setup in the workflow.
