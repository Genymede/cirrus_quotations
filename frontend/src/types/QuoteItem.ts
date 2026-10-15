export type Project = {
    id: string
    name: string
    clientId?: string | null
    clientName?: string | null
}

export type WorkOrder = {
    id: string
    number: string
    title: string
    project_id: string
    description: string
    project: {
        id: string
        name: string
        client: {
            id: string
            name: string
        }
    }
}