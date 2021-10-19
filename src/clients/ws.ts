import ws from 'ws';
import EventEmitter from 'events';
import { GenericCloseCodes, ClientService, GenericOptions } from '../types';
import { __Schema } from '..';

function deepCompareJSON(arg1: any, arg2: any): boolean {
  if (
    Object.prototype.toString.call(arg1) ===
    Object.prototype.toString.call(arg2)
  ) {
    if (
      Object.prototype.toString.call(arg1) === '[object Object]' ||
      Object.prototype.toString.call(arg1) === '[object Array]'
    ) {
      if (Object.keys(arg1).length !== Object.keys(arg2).length) {
        return false;
      }
      return Object.keys(arg1).every(function (key) {
        return deepCompareJSON(arg1[key], arg2[key]);
      });
    }
    return arg1 === arg2;
  }
  return false;
}

let serverSchema: any = null;
let heartbeatInterval = -1;
let heartbeatTimeout = -1;

function createWSClient(url: string) {
  let skt = new ws(url);
  let __client: __WSClient = Object.assign(skt, {
    sendPayload: function (payload: PayloadStructure<any>, ...args: any) {
      this.send(JSON.stringify(payload), ...args);
    }
  });
  return __client;
}

export interface WSOptions {
  url: string;
}

interface __WSClient extends ws {
  sendPayload(payload: PayloadStructure<any>): void;
}

export default class WSService extends EventEmitter implements ClientService {
  public name = 'ws';
  private token: string;
  private client: __WSClient;
  public serviceOptions: WSOptions = {
    url: 'ws://localhost:8000/manager'
  };
  public options: GenericOptions;
  async sendData(type: 0 | 1 | 2, data: any) {}
  disconnect(code: GenericCloseCodes) {}
  private __disconnect(code: WSClientCloseCode) {}
  async startCCC(
    to: number | 'all',
    data: string
  ): Promise<{ id: string; data: string | string[] }> {
    return { id: 'a', data };
  }
  constructor(
    token: string,
    options: GenericOptions,
    serviceOptions: WSOptions
  ) {
    super();
    this.token = token;
    if (options) Object.assign(this.options, options);
    if (serviceOptions) Object.assign(this.serviceOptions, options);
    this.client = createWSClient(this.serviceOptions.url);
  }
  connect() {
    return new Promise<void>((resolve, reject) => {
      this.client.once('close', code => {
        reject(code);
      });
      this.client.once('message', data => {
        let parsed: PayloadStructure<ServerStructures.Identify>;
        try {
          parsed = JSON.parse(data.toString());
        } catch (err) {
          this.client.close(WSClientCloseCode.Abnormal);
          reject('Server responded with malformed response.');
          return;
        }

        if (parsed.op === ServerOpCodes.Identify) {
          heartbeatInterval = parsed.d.heartbeatTimeout;
          serverSchema = parsed.d.schema;
          if (!deepCompareJSON(serverSchema, __Schema)) {
            this.client.close(WSClientCloseCode.Abnormal);
            reject('Server schema and client schema are mismatched.');
            return;
          }
          this.client.sendPayload({
            op: ClientOpCodes.Identity,
            d: {
              token: this.token,
              cluster: this.options.cluster.id,
              clusters: this.options.cluster.count
            }
          } as PayloadStructure<ClientStructures.Identity>);
          this.client.once('message', data => {
            let parsed: PayloadStructure<ServerStructures.Heartbeat>;
            try {
              parsed = JSON.parse(data.toString());
            } catch (err) {
              this.__disconnect(WSClientCloseCode.Abnormal);
              reject('Server responded with malformed response.');
              return;
            }

            if (parsed.op === ServerOpCodes.Heartbeat) {
              this.handleHeartbeat();

              this.client.on('message', this.handleServerPayload);
              resolve();
            } else {
              this.__disconnect(WSClientCloseCode.Abnormal);
              reject('Server responded with invalid Op code.');
              return;
            }
          });
        } else {
          this.__disconnect(WSClientCloseCode.Abnormal);
          reject('Server responded with invalid Op code.');
          return;
        }
      });
    });
  }

  private handleHeartbeat() {
    clearTimeout(heartbeatTimeout);
    this.client.sendPayload({
      op: ClientOpCodes.Heartbeat
    } as PayloadStructure<ClientStructures.Heartbeat>);
    let heartbeatTimeoutFunction = () => {
      this.__disconnect(WSClientCloseCode.Normal);
    };
  }
}

export enum ServerOpCodes {
  Heartbeat,
  Identify,
  DataOK,
  CCCPropagate,
  CCCReturn,
  CCCConfirm,
  ClusterStatus,
  DataPushed
}

export enum WSServerCloseCode {
  Normal = 1000,
  NoStatus = 1005,
  Abnormal = 1006,
  ServerError = 1011,
  ServiceRestart = 1012,
  BadGateway = 1014,
  UnknownError = 4000,
  InvalidOpcode = 4001,
  DecodeError = 4002,
  NotAuthenticated = 4003,
  AuthenticationFailed = 4004,
  AlreadyAuthenticated = 4005,
  HeartbeatTimeout = 4006,
  NotReadyForData = 4007,
  Ratelimited = 4008,
  InvalidCluster = 4010,
  InvalidClusterCount = 4011,
  invalidCCCID = 4012
}

export enum WSClientCloseCode {
  Normal = 1000,
  GoingAway = 1001,
  NoStatus = 1005,
  Abnormal = 1006
}

export enum ClientOpCodes {
  Heartbeat,
  Identity,
  SendData,
  CCCBegin,
  CCCReturn
}

export interface PayloadStructure<T> {
  op: ServerOpCodes | ClientOpCodes;
  d?: T;
}

export namespace ServerStructures {
  export interface Heartbeat {}
  export interface Identify {
    heartbeatTimeout: number;
    schema: any;
  }
  export interface DataOK {}
  export interface CCCPropagate {
    id: string;
    data: string;
  }
  export interface CCCReturn {
    id: string;
    from: number | 'all';
    data: string;
  }
  export interface CCCConfirm {
    id: string;
  }
  export interface ClusterStatus {
    count: number;
    connected: number[];
  }
  export interface DataPushed {}
}

export namespace ClientStructures {
  export interface Heartbeat {}
  export interface Identity {
    token: string;
    clusters: number;
    cluster: number;
  }
  export interface SendData {
    type: 0 | 1 | 2;
    data: any;
  }
  export interface CCCBegin {
    to: number | 'all';
    data: string;
  }
  export interface CCCReturn {
    id: string;
    data: string;
  }
}
