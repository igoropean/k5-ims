# K5 QR Inventory Scanner PWA

A compact mobile-first Progressive Web App for scanning the QR codes generated from the Items sheet, entering quantities, and submitting records to Google Sheets through Google Apps Script.

## Tech

- HTML5
- CSS3
- Vanilla JavaScript
- Bootstrap 5.3
- Bootstrap Icons
- SweetAlert2
- html5-qrcode
- PWA manifest + service worker
- Google Apps Script + Google Sheets

## QR format

The app expects the QR payload to contain:

1. Inventory ID
2. Item Description
3. Unit

separated by newline characters, matching:

```text
Items!B5
Items!D5
Items!G5
```

Example:

```text
ITM202599002564
ELECTRICAL - DIY - Extension Cord Universal (ROYU) - 2 GANG
PCS
```

## User flow

Login
→ Enter IR Slip
→ Scan QR
→ Enter quantity
→ Scan more items
→ Review & Confirm
→ Submit
→ Google Sheets
→ New IR Slip

Duplicate Inventory IDs are rejected both in the browser and again on the server.

## Run in VS Code

Because camera access requires a secure context, do not rely on opening `index.html` directly with `file://`.

Use VS Code + Live Server, or another local HTTPS development server.

For GitHub Pages, push the repository and enable GitHub Pages. GitHub Pages uses HTTPS, which is suitable for camera access.

## First configuration

1. Set up Google Apps Script using `apps-script/README-APPS-SCRIPT.md`.
2. Copy the Apps Script `/exec` URL.
3. Paste it into `js/app.js`.
4. Test login.
5. Enter an IR Slip.
6. Scan a QR.
7. Enter quantity.
8. Submit.

## Security note

The spreadsheet should not be published publicly. The Apps Script Web App is the API boundary.

For production, use SHA-256 hashes in the users Password column instead of plaintext passwords.

## Design

The interface is based on the supplied reference image but modernized for mobile:

- light-blue glassmorphism
- red primary action
- blue secondary accents
- compact item cards instead of a wide table
- large camera scan action
- quantity inputs with 2-decimal support
- bottom navigation
- review-before-submit workflow
