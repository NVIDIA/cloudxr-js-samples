/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { nvidiaCloudxrWebpackAlias } = require('../webpack-nvidia-cloudxr-alias.cjs');

module.exports = {
  entry: './src/main.ts',

  cache: {
    type: 'filesystem',
    name: 'simple',
    buildDependencies: {
      config: [__filename],
    },
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },

  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@helpers': path.resolve(__dirname, './helpers'),
      // If OVERRIDE_CLOUDXR_FILENAME is set (testing only), @nvidia/cloudxr resolves to that bundle
      // basename next to package main—not for production. See ../webpack-nvidia-cloudxr-alias.cjs.
      ...nvidiaCloudxrWebpackAlias(__dirname),
    },
  },

  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'build'),
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      favicon: './favicon.ico',
    }),
  ],
};
