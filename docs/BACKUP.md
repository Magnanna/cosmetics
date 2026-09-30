# Backups

Every night at 03:00 Nairobi a GitHub Action (`.github/workflows/backup.yml`) dumps the database
(shop data + login accounts), encrypts it with AES-256 and keeps it for 30 days under
**GitHub → Actions → Nightly database backup → (run) → Artifacts**.

The passphrase is the `BACKUP_PASSPHRASE` value in `.env.local` and the repository secret of the
same name. **Keep a copy in a password manager** — without it the backups can't be opened.

## Restore

```bash
gpg --decrypt kenfri-backup-YYYY-MM-DD_HHMM.tar.gpg > backup.tar   # asks for the passphrase
tar -xf backup.tar
# Into a fresh Supabase project (or after emptying the public schema):
pg_restore --no-owner --no-privileges --dbname "$DATABASE_URL" kenfri.dump
pg_restore --data-only --dbname "$DATABASE_URL" kenfri-auth.dump
npm run db:migrate   # re-applies row-level security and the photo bucket
```

Product photos live in Supabase Storage (`product-images`) and are not in this backup; they can be
re-taken or re-downloaded from the barcode library.
