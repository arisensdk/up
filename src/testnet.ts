import Dockerator from 'dockerator'
import es from 'event-stream'
import path from 'path'

import { Writable } from 'stream'
import ArisenUp from './arisenup'
import imageTag from './imageTag'

export default class Testnet extends Dockerator {
  public operational: boolean
  public arisenup: ArisenUp
  private markOperational?: () => void

  constructor({
    printOutput = false,
    extraParams = '',
    arisenup = new ArisenUp()
  } = {}) {
    const stdout = (es.mapSync((data: string) => {
      if (!this.operational) {
        if (
          data.includes('producer_plugin.cpp') &&
          data.includes('produce_block') &&
          data.includes('Produced block') &&
          data.includes('#2 @ ')
        ) {
          this.operational = true
          if (this.markOperational) {
            this.markOperational()
          }
        }
      }
      return data
    }) as any) as Writable
    if (printOutput) {
      stdout.pipe(process.stdout)
    }
    super({
      image: imageTag,
      command: [
        'bash',
        '-c',
        `aos -e -p arisen -d /mnt/dev/data \
        --config-dir /mnt/dev/config \
        --http-validate-host=false \
        --disable-replay-opts \
        --plugin arisen::producer_plugin \
        --plugin arisen::state_history_plugin \
        --plugin arisen::http_plugin \
        --plugin arisen::chain_api_plugin \
        --http-server-address=0.0.0.0:8888 \
        --state-history-endpoint=0.0.0.0:8080 \
        --access-control-allow-origin=* \
        --contracts-console \
        --verbose-http-errors \
        ${extraParams || ''}`
      ],
      portMappings: ['8888:8888', '8080:8889'],
      stdio: { stdout }
    })
    this.operational = false
    this.arisenup = arisenup
  }

  public async setup() {
    await super.setup({
      context: path.resolve(__dirname, '..', 'image'),
      src: ['Dockerfile']
    })
  }

  public async start() {
    await super.start()
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Testnet start timeout')),
          30000
        )
        this.markOperational = () => {
          clearTimeout(timeout)
          resolve()
        }
      })
      await this.arisenup.loadSystemContracts()
    } catch (error) {
      await this.stop()
      throw error
    }
  }
}
