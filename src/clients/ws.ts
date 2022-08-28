import ws from 'ws';
import EventEmitter from 'events';
import {
  GenericCloseCodes,
  ClientService,
  GenericOptions,
  DataTypes
} from '../types';
import { defaultOptions, __Schema } from '..';
let reconnectTimeout = 5000;

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
let heartbeatTimeout: NodeJS.Timer;

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
  private token: string;
  private client: __WSClient;
  public serviceOptions: WSOptions = {
    url: 'ws://localhost:8000/manager'
  };
  public options: GenericOptions = defaultOptions;
  sendData(type: DataTypes, data: any) {
    return new Promise<boolean>((resolve, reject) => {
      this.client.sendPayload({
        op: ClientOpCodes.SendData,
        d: {
          data,
          type
        }
      } as PayloadStructure<ClientStructures.SendData>);

      let dataOKHandler = (data: ws.RawData) => {
        let dataParsed: PayloadStructure<ServerStructures.DataACK>;
        try {
          dataParsed = JSON.parse(data.toString());
        } catch (err) {
          this.__disconnect(WSClientCloseCode.Abnormal);
          reject('Server responded with malformed response.');
          return;
        }

        if (dataParsed.op !== ServerOpCodes.DataACK) return;
        resolve(dataParsed.d.success);
        this.client.off('message', dataOKHandler);
      };
      this.client.on('message', dataOKHandler);
    });
  }
  disconnect(code: GenericCloseCodes) {
    this.__disconnect(genericToWSCloseCode(code));
  }
  private __disconnect(code: WSClientCloseCode) {
    this.client.close(code);
    if (code === WSClientCloseCode.Normal) {
      // Client is closing the connection, so we can stop the heartbeat
      clearInterval(heartbeatInterval);
      clearTimeout(heartbeatTimeout);
    }
    this.emit('disconnected', code);
  }
  startCCC(
    to: number | 'all',
    data: string
  ): Promise<{ id: string; data: string | string[] }> {
    return new Promise((resolve, reject) => {
      this.client.sendPayload({
        op: ClientOpCodes.CCCBegin,
        d: { data, to }
      } as PayloadStructure<ClientStructures.CCCBegin>);
      let CCCConfirmHandler = (confData: ws.RawData) => {
        let confParsed: PayloadStructure<ServerStructures.CCCConfirm>;
        try {
          confParsed = JSON.parse(confData.toString());
        } catch (err) {
          this.__disconnect(WSClientCloseCode.Abnormal);
          reject('Server responded with malformed response.');
          return;
        }
        if (confParsed.op !== ServerOpCodes.CCCConfirm) return;
        else {
          this.client.off('message', CCCConfirmHandler);
          let CCCReturnHandler = (retData: ws.RawData) => {
            let retParsed: PayloadStructure<ServerStructures.CCCReturn>;
            try {
              retParsed = JSON.parse(retData.toString());
            } catch (err) {
              this.__disconnect(WSClientCloseCode.Abnormal);
              reject('Server responded with malformed response.');
              return;
            }

            if (retParsed.op !== ServerOpCodes.CCCReturn) return;
            else {
              this.client.off('message', CCCReturnHandler);
              resolve({ id: confParsed.d.id, data: retParsed.d.data });
            }
          };
          this.client.on('message', CCCReturnHandler);
        }
      };

      this.client.on('message', CCCConfirmHandler);
    });
  }
  constructor(
    token: string,
    options: GenericOptions,
    serviceOptions: WSOptions
  ) {
    super();
    this.token = token;
    if (options) Object.assign(this.options, options);
    if (serviceOptions) Object.assign(this.serviceOptions, serviceOptions);
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      if (this.client && this.client.readyState === this.client.OPEN)
        reject('Already connected.');
      this.client = createWSClient(this.serviceOptions.url);
      let rejectWithCodeOrError = (rej: number | Error) => {
        reject(rej);
      };
      this.client.once('close', rejectWithCodeOrError);
      this.client.once('error', rejectWithCodeOrError);
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

              this.client.on('message', this.handleServerPayload.bind(this));
              this.client.off('close', rejectWithCodeOrError);
              this.client.off('error', rejectWithCodeOrError);
              this.client.on('close', this.handleCloseOrError.bind(this));
              this.client.on('error', this.handleCloseOrError.bind(this));
              this.emit('connected');
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

  private reconnectWithDelay() {
    if (!this.options.reconnect) return;
    setTimeout(() => {
      this.connect();
    }, reconnectTimeout);
    reconnectTimeout += reconnectTimeout / 4;
  }

  private handleCloseOrError(out: number | Error) {
    this.reconnectWithDelay();
    clearTimeout(heartbeatTimeout);
    this.emit('disconnect', out);
  }

  private handleHeartbeat() {
    clearTimeout(heartbeatTimeout);
    setTimeout(() => {
      if (this.client.readyState === this.client.OPEN)
        this.client.sendPayload({
          op: ClientOpCodes.Heartbeat
        } as PayloadStructure<ClientStructures.Heartbeat>);
    }, heartbeatInterval / 2);
    heartbeatTimeout = setTimeout(() => {
      this.__disconnect(WSClientCloseCode.Normal);
    }, heartbeatInterval);
  }

  private handleServerPayload(data: ws.RawData) {
    let parsed: PayloadStructure<any>;
    try {
      parsed = JSON.parse(data.toString());
    } catch (err) {
      this.__disconnect(WSClientCloseCode.Abnormal);
      return;
    }
    switch (parsed.op) {
      case ServerOpCodes.Identify:
        this.__disconnect(WSClientCloseCode.Abnormal);
        break;
      case ServerOpCodes.Heartbeat:
        this.handleHeartbeat();
        break;
      case ServerOpCodes.ClusterStatus:
        this.emit(
          'cluster_status',
          (parsed as PayloadStructure<ServerStructures.ClusterStatus>).d.count,
          (parsed as PayloadStructure<ServerStructures.ClusterStatus>).d
            .connected
        );
        break;
      case ServerOpCodes.CCCPropagate:
        let CCCQueryCB = (data: string) => {
          this.client.sendPayload({
            op: ClientOpCodes.CCCReturn,
            d: {
              data,
              id: (parsed as PayloadStructure<ServerStructures.CCCPropagate>).d
                .id
            }
          } as PayloadStructure<ClientStructures.CCCReturn>);
        };
        if (this.listeners('CCCQuery').length < 1) CCCQueryCB('Unhandled');
        this.emit(
          'CCCQuery',
          (parsed as PayloadStructure<ServerStructures.CCCPropagate>).d.data,
          CCCQueryCB
        );
        break;
      case ServerOpCodes.DataPushed:
        this.emit('data_pushed');
        break;
      case ServerOpCodes.CCCConfirm:
      case ServerOpCodes.CCCReturn:
      case ServerOpCodes.DataACK:
        break;
      default:
        this.__disconnect(WSClientCloseCode.Abnormal);
    }
  }
}

export enum ServerOpCodes {
  Heartbeat,
  Identify,
  DataACK,
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
  export interface DataACK {
    success: boolean;
  }
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
    type: DataTypes;
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
