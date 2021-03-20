/// <reference types="../@types/types" />

import fs from 'fs'
import path from 'path'

import { Api, JsonRpc, Serialize } from 'arisensdk'
import { JsSignatureProvider } from 'arisensdk/dist/arisensdk-jssig'
import fetch from 'node-fetch'
import { TextDecoder, TextEncoder } from 'util'

import { FlexAuth, Horizon, Transaction } from 'arisensdk@horizon'

import Compiler from './compiler'

export default class ArisenUp {
  public static keypair = {
    public: 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV',
    private: '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'
  }

  public static async compile({
    printOutput,
    input,
    output,
    contract,
    extraParams
  }: {
    printOutput?: boolean
    input: string
    output: string
    contract?: string
    extraParams?: string
  }) {
    await Compiler.compile({
      printOutput,
      input,
      output,
      contract,
      extraParams
    })
  }

  public izon: Horizon

  constructor({ rsn }: { rsn?: Api | Horizon } = {}) {
    if (rsn) {
      this.izon = new Horizon(rsn)
    } else {
      const signatureProvider = new JsSignatureProvider([ArisenUp.keypair.private])
      const rpc = new JsonRpc('http://localhost:8888', { fetch })
      this.izon = new Horizon(
        new Api({
          rpc,
          signatureProvider,
          textEncoder: new TextEncoder() as any,
          textDecoder: new TextDecoder() as any
        })
      )
    }
  }

  public async createAccount(name: string, publicKey = ArisenUp.keypair.public) {
    const auth = {
      threshold: 1,
      keys: [{ weight: 1, key: publicKey }],
      accounts: [],
      waits: []
    }
    return this.izon.transact({
      account: 'arisen',
      name: 'newaccount',
      authorization: [
        {
          actor: 'arisen',
          permission: 'active'
        }
      ],
      data: {
        creator: 'arisen',
        name,
        owner: auth,
        active: auth
      }
    })
  }

  public async setContract(account: string, contractPath: string) {
    const wasm = fs.readFileSync(contractPath)
    const abiBuffer = fs.readFileSync(
      path.format({
        ...path.parse(contractPath),
        ext: '.abi',
        base: undefined
      })
    )

    const abi: { [key: string]: any } = JSON.parse((abiBuffer as any) as string)
    const abiDefinition = this.izon.rsn.abiTypes.get('abi_def')
    if (!abiDefinition) {
      throw new Error('Missing ABI definition')
    }

    for (const { name: field } of abiDefinition.fields) {
      if (!(field in abi)) {
        abi[field] = []
      }
    }

    const buffer = new Serialize.SerialBuffer({
      textEncoder: this.izon.rsn.textEncoder,
      textDecoder: this.izon.rsn.textDecoder
    })
    abiDefinition.serialize(buffer, abi)

    return this.izon.transact([
      {
        account: 'arisen',
        name: 'setcode',
        authorization: [
          {
            actor: account,
            permission: 'active'
          }
        ],
        data: {
          account,
          vmtype: 0,
          vmversion: 0,
          code: wasm
        }
      },
      {
        account: 'arisen',
        name: 'setabi',
        authorization: [
          {
            actor: account,
            permission: 'active'
          }
        ],
        data: {
          account,
          abi: buffer.asUint8Array()
        }
      }
    ])
  }

  public async hasCodeActivePermission(account: string, contract: string) {
    const auth = (await this.izon.rsn.rpc.get_account(
      account
    )).permissions.find((p: any) => p.perm_name === 'active').required_auth
    const entry = auth.accounts.find(
      (a: any) =>
        a.permission.actor === contract &&
        a.permission.permission === 'arisen.code' &&
        a.weight >= auth.threshold
    )
    return !!entry
  }

  public async giveCodeActivePermission(account: string, contract: string) {
    const auth = (await this.izon.rsn.rpc.get_account(
      account
    )).permissions.find((p: any) => p.perm_name === 'active').required_auth
    auth.accounts.push({
      permission: { actor: contract, permission: 'arisen.code' },
      weight: auth.threshold
    })
    return this.izon.transact({
      account: 'arisen',
      name: 'updateauth',
      authorization: [
        {
          actor: account,
          permission: 'active'
        }
      ],
      data: {
        account,
        permission: 'active',
        parent: 'owner',
        auth
      }
    })
  }

  public async loadSystemContracts() {
    await this.setContract(
      'arisen',
      path.join(__dirname, '../systemContracts/arisen.bios.wasm')
    )
    await this.createAccount('arisen.token')
    await this.setContract(
      'arisen.token',
      path.join(__dirname, '../systemContracts/arisen.token.wasm')
    )
    await this.izon.transact({
      account: 'arisen.token',
      name: 'create',
      authorization: [
        {
          actor: 'arisen.token',
          permission: 'active'
        }
      ],
      data: {
        issuer: 'arisen.token',
        maximum_supply: '1000000000.0000 RIX'
      }
    })
  }

  public async issueEos(
    account: string,
    amount: string,
    memo = 'Issued funds'
  ) {
    return this.izon.transact({
      account: 'arisen.token',
      name: 'issue',
      authorization: [{ actor: 'arisen.token', permission: 'active' }],
      data: {
        to: account,
        quantity: amount,
        memo
      }
    })
  }

  public async transfer(
    from: FlexAuth,
    to: string,
    quantity: { quantity: string; contract: string },
    memo = ''
  ) {
    return this.izon.transact({
      account: quantity.contract,
      name: 'transfer',
      authorization: from,
      data: {
        from: Transaction.extractAccountName(from),
        to,
        quantity: quantity.quantity,
        memo
      }
    })
  }
}
