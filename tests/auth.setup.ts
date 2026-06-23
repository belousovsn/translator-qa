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

setup('authenticate', async ({page}) => {
    const { email, password } = requireTestCredentials()

    // Normalize the disposable account's study language to Armenian — the
    // language the authenticated specs assert against (Armenian keyboard,
    // կատու/շուն, "Armenian" labels). The profile study language is stored
    // server-side in user_metadata.main_language and OVERRIDES any locally
    // seeded mainLang on boot, so without this the suite is at the mercy of
    // whatever language the shared account was last left in. Idempotent.
    const supabase = await getSupabase()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Setup sign-in failed: ${signInError.message}`)
    const { data: { user } } = await supabase.auth.getUser()
    if ((user?.user_metadata as { main_language?: string } | undefined)?.main_language !== 'hy') {
        await supabase.auth.updateUser({ data: { main_language: 'hy' } })
    }
    await supabase.auth.signOut()

    const auth = new Auth(page)
    // Before sign-in the page is a fresh guest, so suppress the first-run welcome
    // picker that would otherwise cover the Profile/sign-in controls.
    await suppressFirstRunWelcome(page)
    await page.goto('index.html', {waitUntil: 'networkidle'})
    await auth.signIn(email, password)
    await page.context().storageState({ path: authFile });
})
