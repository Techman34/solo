/*

    Copyright 2018 dYdX Trading Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import { Storage } from "./Storage.sol";


/**
 * @title Permissions
 * @author dYdX
 *
 * TODO
 */
contract Permissions is
    Storage
{
    function trustAddress(
        address externalAddress,
        bool trusted
    )
        external
    {
        require(msg.sender != externalAddress);
        g_trustedAddress[msg.sender][externalAddress] = trusted;
    }
}