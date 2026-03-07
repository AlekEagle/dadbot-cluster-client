import { WebSocket, RawData } from 'ws';
import EventEmitter from 'events';
import {
  GenericCloseCodes,
  ClientService,
  GenericOptions,
  DataTypes,
} from '../../types';
import {
  WSServerCloseCode,
  WSClientCloseCode,
  ClientOpCodes,
  ServerOpCodes,
  parsePayload,
  assertOpCode,
  InvalidOpCodeError,
  InvalidPayloadError,
  OpCodeAssertionError,
} from './Payloads';
import type { ServerStructures, ClientStructures } from './Payloads';
import { defaultOptions, __Schema } from '../..';
let reconnectTimeout = 5000;

function deepCompare(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  let aKeys = Object.keys(a);
  let bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let key of aKeys) {
    if (!b.hasOwnProperty(key)) return false;
    if (!deepCompare(a[key], b[key])) return false;
  }
  return true;
}

export interface WSOptions {
  url: string;
}

function genericToWSCloseCode(code: GenericCloseCodes): WSClientCloseCode {
  let closeCode: WSClientCloseCode;
  switch (code) {
    case GenericCloseCodes.OK:
      closeCode = WSClientCloseCode.Normal;
      break;
    case GenericCloseCodes.ClientError:
      closeCode = WSClientCloseCode.Abnormal;
      break;
    default:
      closeCode = WSClientCloseCode.NoStatus;
  }
  return closeCode;
}

export default class WSService extends EventEmitter implements ClientService {
  public name = 'ws';
  public serviceOptions: WSOptions = {
    url: 'ws://localhost:8000/manager',
  };
  public options: GenericOptions = defaultOptions;
  private token: string;
  private client: WebSocket | null = null;
  private serverSchema: any = null;
  private heartbeatInterval: number = -1;
  private heartbeatTimeout: NodeJS.Timeout = null as unknown as NodeJS.Timeout;

  constructor(
    token: string,
    options: GenericOptions,
    serviceOptions?: WSOptions | null,
  ) {
    super();
    this.token = token;
    if (options) Object.assign(this.options, options);
    if (serviceOptions) Object.assign(this.serviceOptions, serviceOptions);
  }

  public connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      console.debug(
        `[WSService] Attempting to connect to ${this.serviceOptions.url}`,
      );
      // Are we already connected?
      if (this.client && this.client.readyState === this.client.OPEN)
        reject('Already connected.');
      // Create WebSocket client and connect to server
      this.client = new WebSocket(this.serviceOptions.url);
      this.once('connected', () => {
        console.debug(
          '[WSService] Successfully connected to server, waiting for Identify request...',
        );
      });
      // Handle connection errors
      let rejectWithCodeOrError = (rej: number | Error) => {
        reject(rej);
      };
      this.client.once('close', rejectWithCodeOrError);
      this.client.once('error', rejectWithCodeOrError);
      // Handle initial server message (should be Identify)
      this.client.once('message', (data) => {
        if (!this.client) {
          console.error('How the hell did this happen');
          return;
        }
        let payload: ServerStructures;
        try {
          payload = parsePayload(data.toString());
        } catch (err) {
          this.__disconnect(WSClientCloseCode.Abnormal, true);
          reject('Server responded with malformed response.');
          return;
        }
        console.debug(
          `[WSService] Received initial payload from server: ${JSON.stringify(payload)}`,
        );
        try {
          // Assert that the payload is an Identify payload
          assertOpCode<ServerStructures.Identify>(
            payload,
            ServerOpCodes.Identify,
          );
        } catch (err) {
          this.client.close(WSClientCloseCode.Abnormal);
          reject('Server responded with malformed or invalid payload.');
          return;
        }
        // Extract heartbeat interval and server schema from Identify payload
        this.heartbeatInterval = payload.d.heartbeatTimeout;
        this.serverSchema = payload.d.schema;
        console.debug(
          `[WSService] Server heartbeat interval: ${this.heartbeatInterval}ms`,
        );
        console.debug(
          `[WSService] Server schema: ${JSON.stringify(this.serverSchema)}`,
        );
        // Validate server schema against client schema
        if (!deepCompare(this.serverSchema, __Schema)) {
          this.client.close(WSClientCloseCode.Abnormal);
          reject('Server schema and client schema are mismatched.');
          return;
        }

        // Send Identity payload to server
        this.sendPayload<ClientStructures.Identity>({
          op: ClientOpCodes.Identity,
          d: {
            token: this.token,
            cluster: this.options.cluster.id,
            clusters: this.options.cluster.count,
          },
        });
        console.debug(
          '[WSService] Sent Identity payload to server, waiting for first Heartbeat...',
        );
        // Wait for first Heartbeat payload from server
        this.client.once('message', (data) => {
          if (!this.client) {
            console.error('How the hell did this happen');
            return;
          }
          let payload: ServerStructures;

          try {
            payload = parsePayload(data.toString());
          } catch (err) {
            this.__disconnect(WSClientCloseCode.Abnormal, true);
            reject('Server responded with malformed response.');
            return;
          }

          try {
            assertOpCode<ServerStructures.Heartbeat>(
              payload,
              ServerOpCodes.Heartbeat,
            );
          } catch (err) {
            this.client.close(WSClientCloseCode.Abnormal);
            reject('Server responded with malformed or invalid payload.');
            return;
          }
          console.debug('[WSService] Received first Heartbeat from server.');

          // Handle next Heartbeat
          this.handleHeartbeat();

          // Bind event listeners
          this.client.on('message', this.handleServerPayload.bind(this));
          this.client
            .off('close', rejectWithCodeOrError)
            .off('error', rejectWithCodeOrError);
          this.client
            .on('close', this.handleCloseOrError.bind(this))
            .on('error', this.handleCloseOrError.bind(this));

          this.emit('connected');
          resolve();
        });
      });
    });
  }

  public sendData(type: DataTypes, data: any) {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.client || this.client.readyState !== this.client.OPEN) {
        reject('WebSocket client is not connected.');
        return;
      }
      this.sendPayload<ClientStructures.SendData>({
        op: ClientOpCodes.SendData,
        d: {
          data,
          type,
        },
      });

      let dataOKHandler = (data: RawData) => {
        if (!this.client) {
          console.error('How the hell did this happen');
          return;
        }
        let payload: ServerStructures;
        try {
          payload = parsePayload(data.toString());
        } catch (err) {
          this.__disconnect(WSClientCloseCode.Abnormal, true);
          reject('Server responded with malformed response.');
          return;
        }

        try {
          assertOpCode<ServerStructures.DataACK>(
            payload,
            ServerOpCodes.DataACK,
          );
        } catch (err) {
          // Ignore non-DataACK payloads.
          return;
        }

        resolve(payload.d.success);
        this.client.off('message', dataOKHandler);
      };
      this.client.on('message', dataOKHandler);
    });
  }
  public disconnect(code: GenericCloseCodes, reconnect = false) {
    this.__disconnect(genericToWSCloseCode(code), reconnect);
  }
  private __disconnect(code: WSClientCloseCode, reconnect: boolean) {
    if (!this.client) {
      return;
    }
    this.client.close(code);
    if (!reconnect) {
      this.options.reconnect = false;
    }
    this.emit('disconnected', code);
  }
  public startCCC(
    to: number | 'all',
    data: string,
  ): Promise<{ id: string; data: string | string[] }> {
    return new Promise((resolve, reject) => {
      if (!this.client || this.client.readyState !== this.client.OPEN) {
        reject('WebSocket client is not connected.');
        return;
      }
      // Send CCCBegin payload to server
      this.sendPayload<ClientStructures.CCCBegin>({
        op: ClientOpCodes.CCCBegin,
        d: { data, to },
      });
      let CCCConfirmHandler = (confirmData: RawData) => {
        if (!this.client) {
          reject('WebSocket client is not connected.');
          console.error('How the hell did this happen');
          return;
        }
        // Parse and validate CCCConfirm payload from server
        let confirmPayload: ServerStructures;
        try {
          confirmPayload = parsePayload(confirmData.toString());
        } catch (err) {
          this.__disconnect(WSClientCloseCode.Abnormal, true);
          reject('Server responded with malformed response.');
          return;
        }

        try {
          assertOpCode<ServerStructures.CCCBegin>(
            confirmPayload,
            ServerOpCodes.CCCBegin,
          );
        } catch (err) {
          // Ignore non-CCCBegin payloads.
          return;
        }
        this.client.off('message', CCCConfirmHandler);
        let CCCReturnHandler = (retData: RawData) => {
          if (!this.client) {
            reject('WebSocket client is not connected.');
            console.error('How the hell did this happen');
            return;
          }
          let returnPayload = parsePayload(retData.toString());
          try {
            returnPayload = JSON.parse(retData.toString());
          } catch (err) {
            this.__disconnect(WSClientCloseCode.Abnormal, true);
            reject('Server responded with malformed response.');
            return;
          }

          try {
            assertOpCode<ServerStructures.CCCReturn>(
              returnPayload,
              ServerOpCodes.CCCReturn,
            );
          } catch (err) {
            // Ignore non-CCCReturn payloads.
            return;
          }

          // If this is not the CCCReturn that corresponds to our CCCBegin, ignore it.
          if (returnPayload.d.id !== confirmPayload.d.id) {
            return;
          }

          this.client.off('message', CCCReturnHandler);
          resolve({ id: confirmPayload.d.id, data: returnPayload.d.data });
        };
        this.client.on('message', CCCReturnHandler);
      };

      this.client.on('message', CCCConfirmHandler);
    });
  }

  private reconnectWithDelay() {
    if (!this.options.reconnect) return;
    setTimeout(() => {
      this.connect();
    }, reconnectTimeout);
    reconnectTimeout += reconnectTimeout / 4;
  }

  private handleCloseOrError(out: number | Error) {
    this.reconnectWithDelay();
    clearTimeout(this.heartbeatTimeout);
    this.emit('disconnect', out);
  }

  private handleHeartbeat() {
    clearTimeout(this.heartbeatTimeout);
    setTimeout(() => {
      if (!this.client) {
        console.error('How the hell did this happen');
        return;
      }
      if (this.client.readyState === this.client.OPEN)
        this.sendPayload<ClientStructures.Heartbeat>({
          op: ClientOpCodes.Heartbeat,
          d: undefined,
        });
    }, this.heartbeatInterval / 2);
    this.heartbeatTimeout = setTimeout(() => {
      this.__disconnect(WSClientCloseCode.Normal, true);
    }, this.heartbeatInterval);
  }

  private handleServerPayload(data: RawData) {
    let payload: ServerStructures;
    try {
      payload = parsePayload(data.toString());
    } catch (err) {
      this.__disconnect(WSClientCloseCode.Abnormal, true);
      return;
    }

    switch (payload.op) {
      case ServerOpCodes.Identify:
        // The server should never send another Identify payload after the initial one, so this is a protocol violation.
        this.__disconnect(WSClientCloseCode.Abnormal, true);
        break;
      case ServerOpCodes.Heartbeat:
        // Handle heartbeat by resetting the heartbeat timeout.
        this.handleHeartbeat();
        break;
      case ServerOpCodes.ClusterStatus:
        // Emit cluster_status event.
        this.emit('cluster_status', payload.d.count, payload.d.connected);
        break;
      case ServerOpCodes.CCCPropagate:
        // Handle CCCPropagate by sending a CCCReturn payload.
        let CCCQueryCB = (data: string) => {
          this.sendPayload<ClientStructures.CCCReturn>({
            op: ClientOpCodes.CCCReturn,
            d: {
              data,
              id: payload.d.id,
            },
          });
        };
        // If there are no listeners for the CCCQuery event, send a default response to prevent the server from waiting indefinitely for a response that will never come.
        if (this.listeners('CCCQuery').length < 1) CCCQueryCB('Unhandled');
        // Emit CCCQuery event with the data from the CCCPropagate payload and a callback that listeners can use to send a response back to the server.
        this.emit('CCCQuery', payload.d.data, CCCQueryCB);
        break;
      case ServerOpCodes.DataPushed:
        this.emit('data_pushed');
        break;
      // The following op codes are sent by the server in response to client requests, so we don't need to do anything with them here. If we receive any of these op codes outside of the context of a client request, it's a protocol violation, but we'll just ignore it rather than disconnecting to allow for more robust error handling on the server side.
      case ServerOpCodes.CCCBegin:
      case ServerOpCodes.CCCReturn:
      case ServerOpCodes.DataACK:
        break;
      default:
        this.__disconnect(WSClientCloseCode.Abnormal, true);
    }
  }

  private sendPayload<T extends ClientStructures>(payload: T, ...args: any[]) {
    if (this.client && this.client.readyState === this.client.OPEN) {
      this.client.send(JSON.stringify(payload), ...args);
    } else {
      throw new Error('WebSocket client is not connected.');
    }
  }
}
