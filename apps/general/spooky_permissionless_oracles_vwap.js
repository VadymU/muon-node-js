const { axios, toBaseUnit, soliditySha3, BN, multiCall } = MuonAppUtils

const getTimestamp = () => Math.floor(Date.now() / 1000)
const TOKEN_INFO = 'tokenInfo'
const TOTAL_SUPPLY = 'totalSupply'
const PAIRS0_INFO = 'pairs0INFO'
const PAIRS1_INFO = 'pairs1INFO'
const PAIRS_INFO = 'pairsINFO'

const Info_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: '_reserve0', type: 'uint112' },
      { internalType: 'uint112', name: '_reserve1', type: 'uint112' },
      { internalType: 'uint32', name: '_blockTimestampLast', type: 'uint32' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const ERC20_TOTAL_SUPPLY_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
]
const ERC20_DECIMALS_ABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  }
]

const PRICE_TOLERANCE = 0.05
const FANTOM_ID = 250
const SCALE = new BN('1000000000000000000')
const GRAPH_DEPLOYMENT_ID = 'QmQnteZnJmshPHuUbYNxSCVTEyKunncwCUgYiyqEFQeDV7'

const GRAPH_URL =
  'https://api.thegraph.com/subgraphs/name/shayanshiravani/spookyswap'

async function getTokenTxs(pairAddr) {
  try {
    const currentTimestamp = getTimestamp()
    const last30Min = currentTimestamp - 1800
    const query = `
        {
          swaps(
            where: {
              pair: "${pairAddr.toLowerCase()}"
              timestamp_gt: ${last30Min}
            }, 
            orderBy: timestamp, 
            orderDirection: desc
          ) {
            amount0In
            amount1In
            amount0Out
            amount1Out
          }
          _meta{
            deployment
          }
        }
      `

    let { data, status } = await axios.post(GRAPH_URL, {
      query: query
    })
    if (status == 200 && data.data?.hasOwnProperty('swaps')) {
      if (data.data._meta.deployment !== GRAPH_DEPLOYMENT_ID)
        throw { message: 'SUBGRAPH_IS_UPDATED' }
      return data.data.swaps
    }
  } catch (error) {
    console.log('Error happend in fetch query subgraph', error)
  }
}

function getReturnValue(info, methodName) {
  return info.find((item) => item.methodName === methodName).returnValues
}

function getInfoContract(multiCallInfo, filterBy) {
  return multiCallInfo.filter((item) => item.reference.startsWith(filterBy))
}

function getMetadata(multiCallInfo, filterBy) {
  const info = getInfoContract(multiCallInfo, filterBy)
  let metadata = info.map((item) => {
    const reserves = getReturnValue(item.callsReturnContext, 'getReserves')

    return {
      r0: reserves[0],
      r1: reserves[1],

      t0: getReturnValue(item.callsReturnContext, 'token0')[0],
      t1: getReturnValue(item.callsReturnContext, 'token1')[0]
    }
  })
  return metadata
}

function makeCallContextInfo(info, prefix) {
  const contractCallContext = info.map((item) => ({
    reference: prefix + ':' + item,
    contractAddress: item,
    abi: Info_ABI,
    calls: [
      {
        reference: prefix + ':' + item,
        methodName: 'getReserves'
      },
      {
        reference: prefix + ':' + item,
        methodName: 'token0'
      },
      {
        reference: prefix + ':' + item,
        methodName: 'token1'
      }
    ]
  }))

  return contractCallContext
}

function makeCallContextDecimal(metadata, prefix) {
  let callContext = metadata.map((item) => [
    {
      reference: prefix + ':' + 't0' + ':' + item.t0,
      contractAddress: item.t0,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't0' + ':' + item.t0,
          methodName: 'decimals'
        }
      ]
    },
    {
      reference: prefix + ':' + 't1' + ':' + item.t1,
      contractAddress: item.t1,
      abi: ERC20_DECIMALS_ABI,
      calls: [
        {
          reference: 't1' + ':' + item.t1,
          methodName: 'decimals'
        }
      ]
    }
  ])

  callContext = [].concat.apply([], callContext)
  return callContext
}

function getFinalMetaData(resultDecimals, prevMetaData, prefix) {
  let metadata = prevMetaData.map((item) => {
    let t0 = getInfoContract(
      resultDecimals,
      prefix + ':' + 't0' + ':' + item.t0
    )
    let t1 = getInfoContract(
      resultDecimals,
      prefix + ':' + 't1' + ':' + item.t1
    )
    return {
      ...item,
      dec0: new BN(10)
        .pow(new BN(getReturnValue(t0[0].callsReturnContext, 'decimals')[0]))
        .toString(),
      dec1: new BN(10)
        .pow(new BN(getReturnValue(t1[0].callsReturnContext, 'decimals')[0]))
        .toString()
    }
  })
  return metadata
}

async function tokenVWAP(token, pairs, metadata) {
  let pairPrices = []
  let inputToken = token
  let pairVolume = []
  if (!metadata) {
    const contractCallContext = makeCallContextInfo(pairs, PAIRS_INFO)
    let result = await multiCall(FANTOM_ID, contractCallContext)

    metadata = getMetadata(result, PAIRS_INFO)

    let callContextPairs = makeCallContextDecimal(metadata, PAIRS_INFO)
    let resultDecimals = await multiCall(FANTOM_ID, callContextPairs)
    metadata = getFinalMetaData(resultDecimals, metadata, PAIRS_INFO)
  }

  for (let i = 0; i < pairs.length; i++) {
    let index = inputToken.toLowerCase() == metadata[i].t0.toLowerCase() ? 0 : 1

    if (inputToken.toLowerCase() == metadata[i].t0.toLowerCase()) {
      inputToken = metadata[i].t1
    } else if (inputToken.toLowerCase() == metadata[i].t1.toLowerCase()) {
      inputToken = metadata[i].t0
    } else {
      throw 'INVALID_PAIRS'
    }
    const { tokenPrice, sumVolume } = await pairVWAP(pairs[i], index)
    pairPrices.push(tokenPrice)
    pairVolume.push(sumVolume)
  }
  let price = new BN(SCALE)
  let volume = pairVolume.reduce(function (previousValue, currentValue) {
    return previousValue.add(currentValue)
  })
  pairPrices.map((x) => {
    price = price.mul(x).div(SCALE)
  })
  return { price, volume }
}

async function pairVWAP(pair, index) {
  let tokenTxs = await getTokenTxs(pair)
  let sumVolume = new BN('0')
  if (tokenTxs) {
    let sumWeightedPrice = new BN('0')
    for (let i = 0; i < tokenTxs.length; i++) {
      let swap = tokenTxs[i]
      let price = new BN('0')
      let volume = new BN('0')
      switch (index) {
        case 0:
          if (swap.amount0In != 0) {
            let amount0In = toBaseUnit(swap.amount0In, '18')
            let amount1Out = toBaseUnit(swap.amount1Out, '18')
            price = amount1Out.mul(SCALE).div(amount0In)
            volume = amount0In
          } else {
            let amount1In = toBaseUnit(swap.amount1In, '18')
            let amount0Out = toBaseUnit(swap.amount0Out, '18')
            price = amount1In.mul(SCALE).div(amount0Out)
            volume = amount0Out
          }
          break
        case 1:
          if (swap.amount0In != 0) {
            let amount0In = toBaseUnit(swap.amount0In, '18')
            let amount1Out = toBaseUnit(swap.amount1Out, '18')
            price = amount0In.mul(SCALE).div(amount1Out)
            volume = amount1Out
          } else {
            let amount1In = toBaseUnit(swap.amount1In, '18')
            let amount0Out = toBaseUnit(swap.amount0Out, '18')
            price = amount0Out.mul(SCALE).div(amount1In)
            volume = amount1In
          }
          break
        default:
          break
      }
      sumWeightedPrice = sumWeightedPrice.add(price.mul(volume))
      sumVolume = sumVolume.add(volume)
    }
    if (sumVolume > new BN('0')) {
      let tokenPrice = sumWeightedPrice.div(sumVolume)
      return { tokenPrice, sumVolume }
    }
  }
  return { tokenPrice: new BN('0'), sumVolume }
}

async function LPTokenPrice(token, pairs0, pairs1) {
  const contractCallContextToken = makeCallContextInfo([token], TOKEN_INFO)
  const contractCallContextSupply = [
    {
      reference: TOTAL_SUPPLY,
      contractAddress: token,
      abi: ERC20_TOTAL_SUPPLY_ABI,
      calls: [
        {
          reference: TOTAL_SUPPLY,
          methodName: 'totalSupply'
        }
      ]
    }
  ]

  const contractCallContextPairs0 = makeCallContextInfo(pairs0, PAIRS0_INFO)

  const contractCallContextPairs1 = makeCallContextInfo(pairs1, PAIRS1_INFO)

  const contractCallContext = [
    ...contractCallContextToken,
    ...contractCallContextSupply,
    ...contractCallContextPairs0,
    ...contractCallContextPairs1
  ]

  let result = await multiCall(FANTOM_ID, contractCallContext)

  let metadata = getMetadata(result, TOKEN_INFO)

  let pairs0Metadata = getMetadata(result, PAIRS0_INFO)

  let pairs1Metadata = getMetadata(result, PAIRS1_INFO)

  const callContextDecimalToken = makeCallContextDecimal(metadata, TOKEN_INFO)

  let callContextPairs0 = makeCallContextDecimal(pairs0Metadata, PAIRS0_INFO)

  let callContextPairs1 = makeCallContextDecimal(pairs1Metadata, PAIRS1_INFO)

  const contractCallContextDecimal = [
    ...callContextDecimalToken,
    ...callContextPairs0,
    ...callContextPairs1
  ]

  let resultDecimals = await multiCall(FANTOM_ID, contractCallContextDecimal)

  metadata = getFinalMetaData(resultDecimals, metadata, TOKEN_INFO)[0]
  pairs0Metadata = getFinalMetaData(resultDecimals, pairs0Metadata, PAIRS0_INFO)
  pairs1Metadata = getFinalMetaData(resultDecimals, pairs1Metadata, PAIRS1_INFO)

  let totalSupply = getInfoContract(result, TOTAL_SUPPLY)[0].callsReturnContext
  totalSupply = new BN(totalSupply[0].returnValues[0])

  let reserveA = new BN(metadata.r0).mul(SCALE).div(new BN(metadata.dec0))

  let reserveB = new BN(metadata.r1).mul(SCALE).div(new BN(metadata.dec1))

  let totalUSDA = reserveA
  let sumVolume = new BN('0')

  if (pairs0.length) {
    const { price, volume } = await tokenVWAP(
      metadata.t0,
      pairs0,
      pairs0Metadata
    )
    totalUSDA = price.mul(reserveA).div(SCALE)
    sumVolume = volume
  }

  let totalUSDB = reserveB
  if (pairs1.length) {
    const { price, volume } = await tokenVWAP(
      metadata.t1,
      pairs1,
      pairs1Metadata
    )
    totalUSDB = price.mul(reserveB).div(SCALE)
    sumVolume = volume
  }

  let totalUSD = totalUSDA.add(totalUSDB)

  return { price: totalUSD.mul(SCALE).div(totalSupply).toString(), sumVolume }
}

module.exports = {
  APP_NAME: 'spooky_permissionless_oracles_vwap',
  APP_ID: 18,

  onRequest: async function (request) {
    let {
      method,
      data: { params }
    } = request

    switch (method) {
      case 'price':
        let { token, pairs, hashTimestamp } = params
        if (typeof pairs === 'string' || pairs instanceof String) {
          pairs = pairs.split(',')
        }
        let { price, volume } = await tokenVWAP(token, pairs)
        return {
          token: token,
          tokenPrice: price.toString(),
          pairs: pairs,
          volume: volume.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      case 'lp_price': {
        let { token, pairs0, pairs1, hashTimestamp } = params
        if (typeof pairs0 === 'string' || pairs0 instanceof String) {
          pairs0 = pairs0.split(',').filter((x) => x)
        }
        if (typeof pairs1 === 'string' || pairs1 instanceof String) {
          pairs1 = pairs1.split(',').filter((x) => x)
        }

        let { price, sumVolume } = await LPTokenPrice(token, pairs0, pairs1)

        return {
          token: token,
          tokenPrice: price,
          pairs0: pairs0,
          pairs1: pairs1,
          volume: sumVolume.toString(),
          ...(hashTimestamp ? { timestamp: request.data.timestamp } : {})
        }
      }

      default:
        throw { message: `Unknown method ${params}` }
    }
  },

  isPriceToleranceOk: function (price, expectedPrice) {
    let priceDiff = Math.abs(price - expectedPrice)
    if (priceDiff / expectedPrice > PRICE_TOLERANCE) {
      return false
    }
    return true
  },

  hashRequestResult: function (request, result) {
    let {
      method,
      data: { params }
    } = request
    let { hashTimestamp } = params
    switch (method) {
      case 'price': {
        if (
          !this.isPriceToleranceOk(
            result.tokenPrice,
            request.data.result.tokenPrice
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { token, pairs } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs },
          { type: 'uint256', value: request.data.result.tokenPrice },
          { type: 'uint256', value: request.data.result.volume },

          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
      }
      case 'lp_price': {
        if (
          !this.isPriceToleranceOk(
            result.tokenPrice,
            request.data.result.tokenPrice
          )
        ) {
          throw { message: 'Price threshold exceeded' }
        }
        let { token, pairs0, pairs1 } = result

        return soliditySha3([
          { type: 'uint32', value: this.APP_ID },
          { type: 'address', value: token },
          { type: 'address[]', value: pairs0 },
          { type: 'address[]', value: pairs1 },
          { type: 'uint256', value: request.data.result.tokenPrice },
          { type: 'uint256', value: request.data.result.volume },

          ...(hashTimestamp
            ? [{ type: 'uint256', value: request.data.timestamp }]
            : [])
        ])
      }
      default:
        return null
    }
  }
}
