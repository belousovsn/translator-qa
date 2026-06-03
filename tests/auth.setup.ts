import {test as setup} from '@playwright/test';
import path from 'path';
import {Auth} from './../page_objects/auth-modal.js'
import { fileURLToPath } from 'url';
import { requireTestCredentials } from '../src/config.js'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const authFile = path.join(dirname, '../playwright/.auth/user.json');

setup('authenticate', async ({page}) => {
    const { email, password } = requireTestCredentials()
    const auth = new Auth(page)
    await page.goto('index.html', {waitUntil: 'networkidle'})
    await auth.signIn(email, password)
    await page.context().storageState({ path: authFile });
})