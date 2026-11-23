import { createClient } from 'genlayer-js'
import { localnet, studionet, testnetAsimov, testnetBradbury } from 'genlayer-js/chains'
import type { Address } from 'viem'
import type { Eip1193, TxRun, WriteResult } from './types'

declare global {
  interface Window {
    ethereum?: Eip1193
  }
}

const NETWORKS = {
  localnet,
  studionet,
  'testnet-bradbury': testnetBradbury,
  'testnet-asimov': testnetAsimov,
} as const

export type NetworkKey = keyof typeof NETWORKS

export const NETWORK_NAME = (import.meta.env.VITE_NETWORK ?? 'studionet') as NetworkKey
export const CHAIN = NETWORKS[NETWORK_NAME] ?? studionet
export const CONTRACT = (import.meta.env.VITE_CONTRACT_ADDRESS ?? '').trim()
export const IS_CONFIGURED = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT)

const readClient = createClient({ chain: CHAIN })

export function walletClient(account: string, provider: Eip1193) {
  return createClient({
    chain: CHAIN,
    account: account as Address,
    provider: provider as never,
  })
}

// Studio's public RPC allows a small number of non-eth_* calls per minute, and
// a page load asks for the whole board. Cap concurrency and retry a throttled
// read with backoff instead of firing the next burst too early.
const MAX_READS = 3
let activeReads = 0
const waiters: Array<() => void> = []

async function withReadSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeReads >= MAX_READS) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  activeReads += 1
  try {
    return await task()
  } finally {
    activeReads -= 1
    waiters.shift()?.()
  }
}

export async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return withReadSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await readClient.readContract({
          address: CONTRACT as Address,
          functionName,
          args: args as never[],
        })
        return result as T
      } catch (err) {
        const message = String((err as Error)?.message ?? err)
        const transient = /Failed to fetch|rate limit|429|timed out|unknown RPC|socket/i.test(message)
        if (attempt >= 3 || !transient) {
          if (transient) {
            throw new Error('The GenLayer RPC is throttling reads. Wait a moment, then reload.')
          }
          throw err
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)))
      }
    }
  })
}

const CHAIN_HEX = '0x' + CHAIN.id.toString(16)

type ProviderError = { code?: number; message?: string }

/**
 * A wallet connected to another network refuses `eth_sendTransaction` with
 * "chainId should be same as current chainId". Switch first, and add the chain
 * when the wallet has never seen it (MetaMask error 4902).
 */
export async function ensureChain(provider: Eip1193): Promise<void> {
  const current = String(await provider.request({ method: 'eth_chainId' })).toLowerCase()
  if (current === CHAIN_HEX) return
  const switchParams = [{ chainId: CHAIN_HEX }]
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: switchParams })
  } catch (err) {
    const code = (err as ProviderError)?.code
    if (code !== 4902 && code !== -32603) throw err
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: CHAIN.rpcUrls.default.http,
          blockExplorerUrls: CHAIN.blockExplorers?.default
            ? [CHAIN.blockExplorers.default.url]
            : undefined,
        },
      ],
    })
    await provider.request({ method: 'wallet_switchEthereumChain', params: switchParams })
  }
}

export async function connectWallet(): Promise<{ address: string; provider: Eip1193 }> {
  if (!window.ethereum) {
    throw new Error('No EIP-1193 wallet found. Install MetaMask or another browser wallet to transact.')
  }
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]
  if (!accounts || !accounts.length) {
    throw new Error('The wallet returned no account.')
  }
  await ensureChain(window.ethereum)
  return { address: accounts[0], provider: window.ethereum }
}

export async function silentAccount(): Promise<string | null> {
  if (!window.ethereum) return null
  try {
    const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[]
    return accounts && accounts.length ? accounts[0] : null
  } catch {
    return null
  }
}

const STATUS_BY_NUMBER: Record<number, string> = {
  0: 'UNINITIALIZED',
  1: 'PENDING',
  2: 'PROPOSING',
  3: 'COMMITTING',
  4: 'REVEALING',
  5: 'ACCEPTED',
  6: 'UNDETERMINED',
  7: 'FINALIZED',
  8: 'CANCELED',
  9: 'APPEAL_REVEALING',
  10: 'APPEAL_COMMITTING',
  11: 'READY_TO_FINALIZE',
  12: 'VALIDATORS_TIMEOUT',
  13: 'LEADER_TIMEOUT',
}

function stageFor(status: string): TxRun['stage'] {
  if (status === 'FINALIZED') return 'FINALIZED'
  if (status === 'UNDETERMINED' || status === 'VALIDATORS_TIMEOUT' || status === 'LEADER_TIMEOUT') {
    return 'UNDETERMINED'
  }
  if (status === 'CANCELED') return 'CANCELED'
  if (status === 'ACCEPTED' || status === 'READY_TO_FINALIZE') return 'ACCEPTED'
  return 'CONSENSUS'
}

type RawTx = {
  status?: number
  statusName?: string
  consensus_data?: {
    leader_receipt?: Array<{
      execution_result?: string
      result?: { payload?: unknown }
    }>
  }
}

function payloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim()
  if (payload && typeof payload === 'object') {
    const readable = (payload as { readable?: unknown }).readable
    if (typeof readable === 'string') return readable.trim()
    const raw = (payload as { raw?: unknown }).raw
    if (Array.isArray(raw)) {
      try {
        return new TextDecoder().decode(new Uint8Array(raw as number[])).trim()
      } catch {
        return ''
      }
    }
  }
  return ''
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function write(
  client: ReturnType<typeof walletClient>,
  functionName: string,
  args: unknown[] = [],
  value = 0n,
  onStage?: (run: TxRun) => void,
  label = functionName,
): Promise<WriteResult> {
  onStage?.({ label, stage: 'SIGNING' })
  const request = {
    address: CONTRACT as Address,
    functionName,
    args: args as never[],
    value,
  }
  const hash = (await client.writeContract(request)) as string
  onStage?.({ label, stage: 'SUBMITTED', hash })

  let last = ''
  let tx: RawTx | null = null
  for (let attempt = 0; attempt < 160; attempt++) {
    try {
      tx = (await client.getTransaction({ hash: hash as never })) as unknown as RawTx
    } catch {
      await sleep(8_000)
      continue
    }
    const name = tx.statusName ?? (tx.status !== undefined ? STATUS_BY_NUMBER[tx.status] : '')
    if (name && name !== last) {
      last = name
      onStage?.({ label, stage: stageFor(name), status: name, hash })
    }
    if (
      name === 'FINALIZED' ||
      name === 'UNDETERMINED' ||
      name === 'CANCELED' ||
      name === 'VALIDATORS_TIMEOUT' ||
      name === 'LEADER_TIMEOUT'
    ) {
      break
    }
    await sleep(8_000)
  }

  const leader = tx?.consensus_data?.leader_receipt?.[0]
  const execution = leader?.execution_result ?? 'UNKNOWN'
  const payload = payloadText(leader?.result?.payload)
  const status = last || 'UNKNOWN'
  return {
    hash,
    ok: status === 'FINALIZED' && execution === 'SUCCESS',
    status,
    execution,
    payload,
  }
}

export function explorerTx(hash: string): string {
  if (NETWORK_NAME === 'studionet') return 'https://explorer-studio.genlayer.com/tx/' + hash
  if (NETWORK_NAME === 'testnet-bradbury') return 'https://explorer-bradbury.genlayer.com/tx/' + hash
  return ''
}
