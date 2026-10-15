import { initializeApp } from 'firebase/app'
import { getDatabase, ref, runTransaction } from 'firebase/database'

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

const app = initializeApp(firebaseConfig)
const database = getDatabase(app)

type QuotationCounter = {
    period: string
    sequence: number
}

function getBangkokDate(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date())
}

export async function generateQuotationNumber(): Promise<string> {
    const today = getBangkokDate()
    const counterRef = ref(database, 'quotationNumber')

    const result = await runTransaction(counterRef, (currentData) => {
        const current = currentData as QuotationCounter | null

        if (!current || current.period !== today) {
            return {
                period: today,
                sequence: 1,
            }
        }

        return {
            period: today,
            sequence: current.sequence + 1,
        }
    })

    if (!result.committed) {
        throw new Error('Failed to generate quotation number')
    }

    const data = result.snapshot.val() as QuotationCounter

    return `QTS${data.period.split('-').reverse().join('')}${String(data.sequence).padStart(3, '0')}`
}