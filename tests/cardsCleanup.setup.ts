/// <reference types="node" />
import {test as teardown, expect} from '@playwright/test';
import {getSupabase} from './supabase-client.js'
import { requireTestCredentials } from '../src/config.js'
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

teardown('Clean DB and auth session', async ({}, testInfo) => {
    testInfo.annotations.push({ type: 'info', description: 'Starting DB cleanup' });
     // Sign in first so supabase knows who the user is
    const { email, password } = requireTestCredentials()
    const supabase = await getSupabase()
    const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    if (signInError) {
        console.error('Sign in failed:', signInError.message);
        return;
    }

    await deleteAllCardsFromDB()
    expect(await getAllCardsFromDB()).toHaveLength(0)
    await clearAuthSession()
})

async function deleteAllCardsFromDB() {
    const supabase = await getSupabase()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
        console.error('Failed to get user', userError)
        return
    }

    const { error } = await supabase
    .from('Cards')
    .delete()
    .eq('user_id', user.id)
    if (error) {
    console.error('Failed to delete cards:', error.message);
    }
}

async function getAllCardsFromDB() {
    const supabase = await getSupabase()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
        console.error('Failed to get user', userError)
        return
    }
    const { data, error } = await supabase
    .from('Cards')
    .select()
    .eq('user_id', user.id)
    if (error) {
    console.error('Failed to select cards:', error.message);
    }
    return data
}

//cleaning auth 

const __filename = fileURLToPath(import.meta.url)
const dir = path.dirname(__filename)

const authFile = path.join(dir, '../playwright/.auth/user.json');

async function clearAuthSession () {
    if (fs.existsSync(authFile)) {
        fs.unlinkSync(authFile)
    }
}
