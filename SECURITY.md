# Security

Forge Character Builder runs entirely in the browser: characters and uploaded
content stay on the device (IndexedDB) or in the user's own Google Drive when
sync is enabled. There is no server component and no account system.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through the repository's
security advisory form ("Report a vulnerability" under the Security tab)
rather than in a public issue. Include the affected version, steps to
reproduce, and the impact you observed. You will receive an acknowledgement
within a week, and a fix or mitigation is coordinated with you before any
public disclosure.

## Scope

In scope: the engine, the client, the content ingest path (uploaded XML,
`.dnd5e` and package files are untrusted input), the Google Drive sync flow,
and the build and release scripts. Third-party dependencies should be reported
to their own projects, though a heads-up here is welcome.
