import { default as axios } from 'axios';
import BigNumber from 'bignumber.js';
import queryString from 'query-string';
import {
  LimitOrder,
  address,
  Integer,
  SigningMethod,
  ApiOrderQueryV2,
  ApiOrderV2,
  ApiOrder,
  ApiAccount,
  ApiFillQueryV2,
  ApiFillV2,
  ApiFill,
  ApiTradeQueryV2,
  ApiTradeV2,
  ApiTrade,
  ApiMarket,
  SignedLimitOrder,
  ApiOrderOnOrderbook,
  ApiMarketName,
  SignedStopLimitOrder,
  StopLimitOrder,
} from '../types';
import { LimitOrders } from './LimitOrders';
import { StopLimitOrders } from './StopLimitOrders';

const FOUR_WEEKS_IN_SECONDS = 60 * 60 * 24 * 28;
const TAKER_ACCOUNT_OWNER = '0xf809e07870dca762B9536d61A4fBEF1a17178092';
const TAKER_ACCOUNT_NUMBER = new BigNumber(0);
const DEFAULT_API_ENDPOINT = 'https://api.dydx.exchange';
const DEFAULT_API_TIMEOUT = 10000;

export class Api {
  private endpoint: String;
  private limitOrders: LimitOrders;
  private stopLimitOrders: StopLimitOrders;
  private timeout: number;

  constructor(
    limitOrders: LimitOrders,
    stopLimitOrders: StopLimitOrders,
    endpoint: string = DEFAULT_API_ENDPOINT,
    timeout: number = DEFAULT_API_TIMEOUT,
  ) {
    this.endpoint = endpoint;
    this.limitOrders = limitOrders;
    this.stopLimitOrders = stopLimitOrders;
    this.timeout = timeout;
  }

  public async placeOrder({
    makerAccountOwner,
    makerMarket,
    takerMarket,
    makerAmount,
    takerAmount,
    makerAccountNumber = new BigNumber(0),
    expiration = new BigNumber(FOUR_WEEKS_IN_SECONDS),
    fillOrKill = false,
    postOnly = false,
    triggerPrice,
    signedTriggerPrice,
    decreaseOnly,
    clientId,
  }: {
    makerAccountOwner: address,
    makerAccountNumber: Integer | string,
    makerMarket: Integer | string,
    takerMarket: Integer | string,
    makerAmount: Integer | string,
    takerAmount: Integer | string,
    expiration: Integer | string,
    fillOrKill: boolean,
    postOnly: boolean,
    triggerPrice?: Integer,
    signedTriggerPrice?: Integer,
    decreaseOnly?: boolean,
    clientId?: string,
  }): Promise<{ order: ApiOrder }> {
    let order: SignedLimitOrder | SignedStopLimitOrder;
    if (triggerPrice) {
      order = await this.createStopLimitOrder({
        makerAccountOwner,
        makerMarket,
        takerMarket,
        makerAmount,
        takerAmount,
        makerAccountNumber,
        expiration,
        decreaseOnly,
        triggerPrice: signedTriggerPrice,
      });
    } else {
      order = await this.createOrder({
        makerAccountOwner,
        makerMarket,
        takerMarket,
        makerAmount,
        takerAmount,
        makerAccountNumber,
        expiration,
      });
    }
    return this.submitOrder({
      order,
      fillOrKill,
      postOnly,
      clientId,
      triggerPrice,
    });
  }

  public async replaceOrder({
    makerAccountOwner,
    makerMarket,
    takerMarket,
    makerAmount,
    takerAmount,
    makerAccountNumber = new BigNumber(0),
    expiration = new BigNumber(FOUR_WEEKS_IN_SECONDS),
    fillOrKill = false,
    postOnly = false,
    cancelId,
    clientId,
  }: {
    makerAccountOwner: address,
    makerAccountNumber: Integer | string,
    makerMarket: Integer | string,
    takerMarket: Integer | string,
    makerAmount: Integer | string,
    takerAmount: Integer | string,
    expiration: Integer | string,
    fillOrKill: boolean,
    postOnly: boolean,
    cancelId: string,
    clientId?: string,
  }): Promise<{ order: ApiOrder }> {
    const [
      order,
      cancelSignature,
    ] = await Promise.all([
      this.createOrder({
        makerAccountOwner,
        makerMarket,
        takerMarket,
        makerAmount,
        takerAmount,
        makerAccountNumber,
        expiration,
      }),
      this.limitOrders.signCancelOrderByHash(
        cancelId,
        makerAccountOwner,
        SigningMethod.Hash,
      ),
    ]);
    return this.submitReplaceOrder({
      order,
      fillOrKill,
      postOnly,
      cancelId,
      cancelSignature,
      clientId,
    });
  }

  /**
   * Submits an already signed replaceOrder
   */
  public async submitReplaceOrder({
    order,
    fillOrKill = false,
    postOnly = false,
    cancelId,
    cancelSignature,
    clientId,
  }: {
    order: SignedLimitOrder,
    fillOrKill: boolean,
    postOnly: boolean,
    cancelId: string,
    cancelSignature: string,
    clientId?: string,
  }): Promise<{ order: ApiOrder }> {
    const jsonOrder = jsonifyOrder(order);

    const data: any = {
      cancelId,
      cancelSignature,
      postOnly,
      order: jsonOrder,
      fillOrKill: !!fillOrKill,
    };
    if (clientId) {
      data.clientId = clientId;
    }

    const response = await axios({
      data,
      method: 'post',
      url: `${this.endpoint}/v1/dex/orders/replace`,
      timeout: this.timeout,
    });

    return response.data;
  }

  /**
   * Creates, but does not place a signed order
   */
  public async createOrder({
    makerAccountOwner,
    makerMarket,
    takerMarket,
    makerAmount,
    takerAmount,
    makerAccountNumber = new BigNumber(0),
    expiration = new BigNumber(FOUR_WEEKS_IN_SECONDS),
  }: {
    makerAccountOwner: address,
    makerAccountNumber: Integer | string,
    makerMarket: Integer | string,
    takerMarket: Integer | string,
    makerAmount: Integer | string,
    takerAmount: Integer | string,
    expiration: Integer | string,
  }): Promise<SignedLimitOrder> {
    const realExpiration: BigNumber = getRealExpiration(expiration);
    const order: LimitOrder = {
      makerAccountOwner,
      makerAccountNumber: new BigNumber(makerAccountNumber),
      makerMarket: new BigNumber(makerMarket),
      takerMarket: new BigNumber(takerMarket),
      makerAmount: new BigNumber(makerAmount),
      takerAmount: new BigNumber(takerAmount),
      expiration: realExpiration,
      takerAccountOwner: TAKER_ACCOUNT_OWNER,
      takerAccountNumber: TAKER_ACCOUNT_NUMBER,
      salt: generatePseudoRandom256BitNumber(),
    };
    const typedSignature: string = await this.limitOrders.signOrder(
      order,
      SigningMethod.Hash,
    );

    return {
      ...order,
      typedSignature,
    };
  }

  /**
   * Creates, but does not place a signed order
   */
  public async createStopLimitOrder({
    makerAccountOwner,
    makerMarket,
    takerMarket,
    makerAmount,
    takerAmount,
    makerAccountNumber = new BigNumber(0),
    expiration = new BigNumber(FOUR_WEEKS_IN_SECONDS),
    decreaseOnly,
    triggerPrice,
  }: {
    makerAccountOwner: address,
    makerAccountNumber: Integer | string,
    makerMarket: Integer | string,
    takerMarket: Integer | string,
    makerAmount: Integer | string,
    takerAmount: Integer | string,
    expiration: Integer | string,
    decreaseOnly: boolean,
    triggerPrice: Integer,
  }): Promise<SignedStopLimitOrder> {
    const realExpiration: BigNumber = getRealExpiration(expiration);
    const order: StopLimitOrder = {
      makerAccountOwner,
      decreaseOnly,
      makerAccountNumber: new BigNumber(makerAccountNumber),
      makerMarket: new BigNumber(makerMarket),
      takerMarket: new BigNumber(takerMarket),
      makerAmount: new BigNumber(makerAmount),
      takerAmount: new BigNumber(takerAmount),
      expiration: realExpiration,
      takerAccountOwner: TAKER_ACCOUNT_OWNER,
      takerAccountNumber: TAKER_ACCOUNT_NUMBER,
      salt: generatePseudoRandom256BitNumber(),
      triggerPrice: new BigNumber(triggerPrice),
    };

    const typedSignature: string = await this.stopLimitOrders.signOrder(
      order,
      SigningMethod.Hash,
    );

    return {
      ...order,
      typedSignature,
    };
  }

  /**
   * Submits an already signed order
   */
  public async submitOrder({
    order,
    fillOrKill = false,
    postOnly = false,
    triggerPrice,
    clientId,
  }: {
    order: SignedLimitOrder | SignedStopLimitOrder,
    fillOrKill: boolean,
    postOnly: boolean,
    triggerPrice?: Integer,
    clientId?: string,
  }): Promise<{ order: ApiOrder }> {
    const jsonOrder = jsonifyOrder(order);

    const data: any = {
      postOnly,
      order: jsonOrder,
      fillOrKill: !!fillOrKill,
    };
    if (triggerPrice) {
      data.triggerPrice = triggerPrice;
    }
    if (clientId) {
      data.clientId = clientId;
    }

    const response = await axios({
      data,
      method: 'post',
      url: `${this.endpoint}/v1/dex/orders`,
      timeout: this.timeout,
    });

    return response.data;
  }

  public async cancelOrder({
    orderId,
    makerAccountOwner,
  }: {
    orderId: string,
    makerAccountOwner: address,
  }): Promise<{ order: ApiOrder }> {
    const signature = await this.limitOrders.signCancelOrderByHash(
      orderId,
      makerAccountOwner,
      SigningMethod.Hash,
    );

    const response = await axios({
      url: `${this.endpoint}/v1/dex/orders/${orderId}`,
      method: 'delete',
      headers: {
        authorization: `Bearer ${signature}`,
      },
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getOrdersV2({
    accountOwner,
    accountNumber,
    side,
    status,
    orderType,
    market,
    limit,
    startingBefore,
  }: ApiOrderQueryV2): Promise<{ orders: ApiOrderV2[] }> {
    const queryObj: any = {
      side,
      orderType,
      limit,
      market,
      status,
      accountOwner,
      accountNumber: accountNumber && new BigNumber(accountNumber).toFixed(0),
      startingBefore: startingBefore && startingBefore.toISOString(),
    };

    const query: string = queryString.stringify(queryObj, { skipNull: true, arrayFormat: 'comma' });
    const response = await axios({
      url: `${this.endpoint}/v2/orders?${query}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getOrders({
    startingBefore,
    limit,
    pairs,
    makerAccountOwner,
    makerAccountNumber,
    status,
  }: {
    startingBefore?: Date,
    limit: number,
    pairs?: string[],
    makerAccountNumber?: Integer | string,
    makerAccountOwner?: address,
    status?: string[],
  }): Promise<{ orders: ApiOrder[] }> {
    const queryObj: any = {};

    if (startingBefore) {
      queryObj.startingBefore = startingBefore.toISOString();
    }
    if (limit) {
      queryObj.limit = limit;
    }
    if (pairs) {
      queryObj.pairs = pairs.join();
    }
    if (status) {
      queryObj.status = status.join();
    }
    if (makerAccountOwner) {
      queryObj.makerAccountOwner = makerAccountOwner;

      if (makerAccountNumber) {
        queryObj.makerAccountNumber = new BigNumber(makerAccountNumber).toFixed(0);
      } else {
        queryObj.makerAccountNumber = '0';
      }
    }

    const query: string = queryString.stringify(queryObj);

    const response = await axios({
      url: `${this.endpoint}/v1/dex/orders${query.length > 0 ? '?' : ''}${query}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getOrderV2({
    id,
  }: {
    id: string,
  }): Promise<{ order: ApiOrderV2 }> {
    const response = await axios({
      url: `${this.endpoint}/v2/orders/${id}`,
      method: 'get',
      timeout: this.timeout,
    });
    return response.data;
  }

  public async getOrder({
    id,
  }: {
    id: string,
  }): Promise<{ order: ApiOrder }> {
    const response = await axios({
      url: `${this.endpoint}/v1/dex/orders/${id}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getFillsV2({
    orderId,
    side,
    market,
    transactionHash,
    accountOwner,
    accountNumber,
    startingBefore,
    limit,
  }: ApiFillQueryV2): Promise<{ fills: ApiFillV2[] }> {
    const queryObj: any = {
      orderId,
      side,
      limit,
      market,
      status,
      transactionHash,
      accountOwner,
      accountNumber: accountNumber && new BigNumber(accountNumber).toFixed(0),
      startingBefore: startingBefore && startingBefore.toISOString(),
    };

    const query: string = queryString.stringify(queryObj, { skipNull: true, arrayFormat: 'comma' });

    const response = await axios({
      url: `${this.endpoint}/v2/fills?${query}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getFills({
    makerAccountOwner,
    startingBefore,
    limit,
    pairs,
    makerAccountNumber,
  }: {
    makerAccountOwner?: address,
    startingBefore?: Date,
    limit?: number,
    pairs?: string[],
    makerAccountNumber?: Integer | string,
  }): Promise<{ fills: ApiFill[] }> {
    const queryObj: any = { makerAccountOwner };

    if (startingBefore) {
      queryObj.startingBefore = startingBefore.toISOString();
    }
    if (limit) {
      queryObj.limit = limit;
    }
    if (pairs) {
      queryObj.pairs = pairs.join();
    }
    if (makerAccountNumber) {
      queryObj.makerAccountNumber = new BigNumber(makerAccountNumber).toFixed(0);
    } else {
      queryObj.makerAccountNumber = '0';
    }

    const query: string = queryString.stringify(queryObj);

    const response = await axios({
      url: `${this.endpoint}/v1/dex/fills?${query}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getTradesV2({
    orderId,
    side,
    market,
    transactionHash,
    accountOwner,
    accountNumber,
    startingBefore,
    limit,
  }: ApiTradeQueryV2): Promise<{ trades: ApiTradeV2[] }> {
    const queryObj: any = {
      orderId,
      side,
      limit,
      market,
      status,
      transactionHash,
      accountOwner,
      accountNumber: accountNumber && new BigNumber(accountNumber).toFixed(0),
      startingBefore: startingBefore && startingBefore.toISOString(),
    };

    const query: string = queryString.stringify(queryObj, { skipNull: true, arrayFormat: 'comma' });

    const response = await axios({
      url: `${this.endpoint}/v2/trades?${query}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getTrades({
    makerAccountOwner,
    startingBefore,
    limit,
    pairs,
    makerAccountNumber,
  }: {
    makerAccountOwner?: address,
    startingBefore?: Date,
    limit?: number,
    pairs?: string[],
    makerAccountNumber?: Integer | string,
  }): Promise<{ trades: ApiTrade[] }> {
    const queryObj: any = { makerAccountOwner };

    if (startingBefore) {
      queryObj.startingBefore = startingBefore.toISOString();
    }
    if (limit) {
      queryObj.limit = limit;
    }
    if (pairs) {
      queryObj.pairs = pairs.join();
    }
    if (makerAccountNumber) {
      queryObj.makerAccountNumber = new BigNumber(makerAccountNumber).toFixed(0);
    } else {
      queryObj.makerAccountNumber = '0';
    }

    const query: string = queryString.stringify(queryObj);

    const response = await axios({
      url: `${this.endpoint}/v1/dex/trades?${query}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getAccountBalances({
    accountOwner,
    accountNumber = new BigNumber(0),
  }: {
    accountOwner: address,
    accountNumber: Integer | string,
  }): Promise<ApiAccount> {
    const numberStr = new BigNumber(accountNumber).toFixed(0);

    const response = await axios({
      url: `${this.endpoint}/v1/accounts/${accountOwner}?number=${numberStr}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getOrderbook({
    pair,
    minSize,
    limit,
    offset,
  }: {
    pair: string,
    minSize?: Integer | string,
    limit?: number,
    offset?: number,
  }): Promise<{ orders: ApiOrder[] }> {
    const queryObj: any = {};

    if (pair) {
      queryObj.pairs = pair;
    }
    if (limit) {
      queryObj.limit = limit;
    }
    if (offset) {
      queryObj.offset = offset;
    }
    if (minSize) {
      queryObj.minSize = new BigNumber(minSize).toFixed(0);
    }

    const query: string = queryString.stringify(queryObj);

    const response = await axios({
      url: `${this.endpoint}/v1/dex/orders?${query}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getOrderbookV2({
    market,
  }: {
    market: ApiMarketName,
  }): Promise<{ bids: ApiOrderOnOrderbook[], asks: ApiOrderOnOrderbook[] }> {
    const response = await axios({
      url: `${this.endpoint}/v1/orderbook/${market}`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }

  public async getMarkets(): Promise<{ markets: ApiMarket[] }> {
    const response = await axios({
      url: `${this.endpoint}/v1/markets`,
      method: 'get',
      timeout: this.timeout,
    });

    return response.data;
  }
}

function generatePseudoRandom256BitNumber(): BigNumber {
  const MAX_DIGITS_IN_UNSIGNED_256_INT = 78;

  // BigNumber.random returns a pseudo-random number between 0 & 1 with a passed in number of
  // decimal places.
  // Source: https://mikemcl.github.io/bignumber.js/#random
  const randomNumber = BigNumber.random(MAX_DIGITS_IN_UNSIGNED_256_INT);
  const factor = new BigNumber(10).pow(MAX_DIGITS_IN_UNSIGNED_256_INT - 1);
  const randomNumberScaledTo256Bits = randomNumber.times(factor).integerValue();
  return randomNumberScaledTo256Bits;
}

function jsonifyOrder(order) {
  return {
    typedSignature: order.typedSignature,
    makerAccountOwner: order.makerAccountOwner,
    makerAccountNumber: order.makerAccountNumber.toFixed(0),
    takerAccountOwner: order.takerAccountOwner,
    takerAccountNumber: order.takerAccountNumber.toFixed(0),
    makerMarket: order.makerMarket.toFixed(0),
    takerMarket: order.takerMarket.toFixed(0),
    makerAmount: order.makerAmount.toFixed(0),
    takerAmount: order.takerAmount.toFixed(0),
    salt: order.salt.toFixed(0),
    expiration: order.expiration.toFixed(0),
  };
}

function getRealExpiration(expiration: Integer | string): BigNumber {
  return new BigNumber(expiration).eq(0) ?
    new BigNumber(0)
    : new BigNumber(Math.round(new Date().getTime() / 1000)).plus(
      new BigNumber(expiration),
    );
}
