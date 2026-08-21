import Database from 'better-sqlite3'
import { deflateRawSync } from 'zlib'

const FIELD_SEPARATOR = '\x1f'

const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
)

function crc32(data: Buffer): number {
    let crc = 0xffffffff
    for (const byte of data) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
        }
    }
    return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries: Array<{ name: string, data: Buffer }>): Buffer {
    const localChunks: Buffer[] = []
    const centralChunks: Buffer[] = []
    let offset = 0

    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8')
        const payload = deflateRawSync(entry.data)
        const checksum = crc32(entry.data)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt16LE(8, 8)
        local.writeUInt32LE(checksum, 14)
        local.writeUInt32LE(payload.length, 18)
        local.writeUInt32LE(entry.data.length, 22)
        local.writeUInt16LE(name.length, 26)

        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0)
        central.writeUInt16LE(20, 4)
        central.writeUInt16LE(20, 6)
        central.writeUInt16LE(8, 10)
        central.writeUInt32LE(checksum, 16)
        central.writeUInt32LE(payload.length, 20)
        central.writeUInt32LE(entry.data.length, 24)
        central.writeUInt16LE(name.length, 28)
        central.writeUInt32LE(offset, 42)

        localChunks.push(local, name, payload)
        centralChunks.push(central, name)
        offset += local.length + name.length + payload.length
    }

    const directory = Buffer.concat(centralChunks)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(directory.length, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...localChunks, directory, end])
}

export function buildRealAnkiPackage(collectionCreatedAt = Math.floor(Date.now() / 1000)): Buffer {
    const db = new Database(':memory:')
    db.exec(`
        CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, models TEXT, decks TEXT);
        CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, flds TEXT, tags TEXT);
        CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER);
    `)

    db.prepare('INSERT INTO col (id, crt, models, decks) VALUES (1, ?, ?, ?)').run(
        collectionCreatedAt,
        JSON.stringify({ '1': { name: 'Basic', type: 0 } }),
        JSON.stringify({ '1': { name: 'German' }, '2': { name: 'Spanish' } }),
    )

    const insertNote = db.prepare('INSERT INTO notes (id, guid, mid, flds, tags) VALUES (?, ?, 1, ?, ?)')
    const insertCard = db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, 0)')
    const notes = [
        { id: 1, guid: 'real-hund', deck: 1, fields: ['Hund [sound:hund.mp3]', 'dog', '<img src="dog.png">'] },
        { id: 2, guid: 'real-katze', deck: 2, fields: ['Katze', 'cat'] },
        { id: 3, guid: 'real-vogel', deck: 1, fields: ['Vogel', 'bird', '<img src="bad.svg">'] },
        { id: 4, guid: 'real-sentence', deck: 1, fields: ['Wie geht es dir heute?', 'How are you today?'] },
    ]
    for (const note of notes) {
        insertNote.run(note.id, note.guid, note.fields.join(FIELD_SEPARATOR), '')
        insertCard.run(note.id * 10, note.id, note.deck)
    }

    const collection = db.serialize()
    db.close()

    return buildZip([
        { name: 'collection.anki2', data: collection },
        { name: 'media', data: Buffer.from(JSON.stringify({ '0': 'dog.png', '1': 'hund.mp3', '2': 'bad.svg' })) },
        { name: '0', data: ONE_PIXEL_PNG },
        { name: '1', data: Buffer.from('ID3test-audio') },
        { name: '2', data: Buffer.from('<svg><script>alert(1)</script></svg>') },
    ])
}

export function buildNewFormatAnkiPackage(): Buffer {
    return buildZip([{ name: 'collection.anki21b', data: Buffer.from('zstd bytes') }])
}
