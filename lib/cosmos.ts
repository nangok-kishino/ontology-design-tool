import { CosmosClient, type Container } from "@azure/cosmos"

const DB_ID = process.env.COSMOS_DATABASE_ID || "ontology-db"

// HMRでモジュールが再読み込みされても接続を使い回す
const g = global as typeof global & { _cosmosClient?: CosmosClient }

function getClient(): CosmosClient {
  if (!g._cosmosClient) {
    const endpoint = process.env.COSMOS_ENDPOINT
    const key = process.env.COSMOS_KEY
    if (!endpoint || !key) {
      throw new Error("環境変数 COSMOS_ENDPOINT と COSMOS_KEY を設定してください")
    }
    g._cosmosClient = new CosmosClient({ endpoint, key })
  }
  return g._cosmosClient
}

export async function getContainer(containerId: string): Promise<Container> {
  const client = getClient()
  const { database } = await client.databases.createIfNotExists({ id: DB_ID })
  const { container } = await database.containers.createIfNotExists({
    id: containerId,
    partitionKey: { paths: ["/id"] },
  })
  return container
}
