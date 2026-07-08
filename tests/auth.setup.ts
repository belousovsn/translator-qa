import {test as setup} from '@playwright/test';
import path from 'path';
import {Auth} from './../page_objects/auth-modal.js'
import { suppressFirstRunWelcome } from '../page_objects/first-run.js'
import { getSupabase } from './supabase-client.js'
import { fileURLToPath } from 'url';
import { requireTestCredentials } from '../src/config.js'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const authFile = path.join(dirname, '../playwright/.auth/user.json');

/**
 * Normalize the disposable account's study language to Armenian so the
 * authenticated specs (which assert "Armenian" labels, katu/shun, etc.) are
 * deterministic regardless of what language was last set on the account.
 *
 * The profile study language lives in user_metadata.main_language (Supabase)
 * and overrides any locally-seeded mainLang on every page load, so we must
 * update it server-side.
 *
 * Wrapped in an 8-second soft timeout: if Supabase is unreachable from the
 * VPS (which would cause Node fetch to hang indefinitely), we skip the
 * normalisation and continue — the auth tests will still run, and if the
 * account already has 'hy' set from a prior run, they'll pass.
 */
async function normalizeStudyLanguage(email: string, password: string): Promise<void> {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
        console.warn('[auth-setup] normalisation sign-in failed:', error.message)
        return
    }
    // updateUser is idempotent — no need to fetch the current value first
    await supabase.auth.updateUser({ data: { main_language: 'hy' } })
    // Local scope only: the default global signOut revokes EVERY session of the
    // shared test account, killing tokens that parallel API specs are using.
    await supabase.auth.signOut({ scope: 'local' })
}

setup('authenticate', async ({page}) => {
    const { email, password } = requireTestCredentials()

    const timeout = new Promise<void>(resolve => setTimeout(resolve, 8_000))
    await Promise.race([normalizeStudyLanguage(email, password), timeout])
        .catch(err => console.warn('[auth-setup] study-language normalisation skipped:', (err as Error).message))

    const auth = new Auth(page)
    // Before sign-in the page is a fresh guest, so suppress the first-run welcome
    // picker that would otherwise cover the Profile/sign-in controls.
    await suppressFirstRunWelcome(page)
    await page.goto('index.html', {waitUntil: 'networkidle'})
    await auth.signIn(email, password)
    await page.context().storageState({ path: authFile });
})
