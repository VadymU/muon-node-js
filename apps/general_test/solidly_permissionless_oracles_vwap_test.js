require('dotenv').config({ path: './dev-chain/dev-node-1.env' })
require('../../core/global')
const { onRequest } = require('../general/solidly_permissionless_oracles_vwap')

const testLP = async () => {
  let method = 'lp_price'
  const { tokenPrice, volume } = await onRequest({
    method,
    data: {
      params: {
        token: '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058',
        pairs0: '0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0',
        pairs1:
          '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058,0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0'
      }
    }
  })
  console.log('\n \nResult for LP_PRICE:')
  console.log({ tokenPrice, volume })
}

const testPrice = async () => {
  let method = 'price'
  const { tokenPrice, volume } = await onRequest({
    method,
    data: {
      params: {
        token: '0xDE5ed76E7c05eC5e4572CfC88d1ACEA165109E44',
        pairs:
          '0xF42dBcf004a93ae6D5922282B304E2aEFDd50058,0x5821573d8F04947952e76d94f3ABC6d7b43bF8d0'
      }
    }
  })
  console.log('\n \nResult for PRICE:')
  console.log({ tokenPrice, volume })
}

testLP()
testPrice()
