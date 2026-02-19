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

/**
 * CloudXRUI.tsx - CloudXR User Interface Component
 *
 * This component renders the in-VR user interface for the CloudXR application using
 * React Three UIKit. It provides:
 * - CloudXR branding and title display
 * - Server connection information and status display
 * - Interactive control buttons (Start Teleop, Reset Teleop, Disconnect)
 * - Responsive button layout with hover effects
 * - Integration with parent component event handlers
 * - Configurable position and rotation in world space for flexible UI placement
 *
 * The UI is positioned in 3D space and designed for VR/AR interaction with
 * visual feedback and clear button labeling. All interactions are passed
 * back to the parent component through callback props.
 */

import { Container, Text, Image } from '@react-three/uikit';
import { Button } from '@react-three/uikit-default';
import React from 'react';

interface CloudXRUIProps {
  onStartTeleop?: () => void;
  onDisconnect?: () => void;
  onResetTeleop?: () => void;
  serverAddress?: string;
  sessionStatus?: string;
  playLabel?: string;
  playDisabled?: boolean;
  countdownSeconds?: number;
  onCountdownIncrease?: () => void;
  onCountdownDecrease?: () => void;
  countdownDisabled?: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export default function CloudXR3DUI({
  onStartTeleop,
  onDisconnect,
  onResetTeleop,
  serverAddress = '127.0.0.1',
  sessionStatus = 'Disconnected',
  playLabel = 'Play',
  playDisabled = false,
  countdownSeconds,
  onCountdownIncrease,
  onCountdownDecrease,
  countdownDisabled = false,
  position = [1.8, 1.75, -1.3],
  rotation = [0, -0.3, 0],
}: CloudXRUIProps) {
  return (
    <group position={position} rotation={rotation}>
      <Container
        pixelSize={0.001}
        width={1920}
        height={1584}
        alignItems="center"
        justifyContent="center"
        pointerEvents="auto"
        padding={40}
        sizeX={3}
        sizeY={2.475}
      >
        <Container
          width={1600}
          height={900}
          backgroundColor="rgba(40, 40, 40, 0.85)"
          borderRadius={20}
          padding={60}
          paddingBottom={80}
          alignItems="center"
          justifyContent="center"
          flexDirection="column"
          gap={36}
        >
          {/* Title */}
          <Text fontSize={96} fontWeight="bold" color="white" textAlign="center">
            Controls
          </Text>

          {/* Server Info */}
          <Text fontSize={48} color="white" textAlign="center" marginBottom={24}>
            Server address: {serverAddress}
          </Text>
          <Text fontSize={48} color="white" textAlign="center" marginBottom={48}>
            Session status: {sessionStatus}
          </Text>

          {/* Countdown Config Row */}
          <Container flexDirection="row" gap={24} alignItems="center" justifyContent="center">
            <Text fontSize={40} color="white">
              Countdown
            </Text>
            <Button
              onClick={onCountdownDecrease}
              variant="default"
              width={105}
              height={105}
              borderRadius={52.5}
              backgroundColor="rgba(220, 220, 220, 0.9)"
              disabled={countdownDisabled}
            >
              <Text fontSize={48} color="black" fontWeight="bold">
                -
              </Text>
            </Button>
            <Container
              width={180}
              height={105}
              alignItems="center"
              justifyContent="center"
              backgroundColor="rgba(255,255,255,0.9)"
              borderRadius={12}
            >
              <Text fontSize={56} color="black">
                {countdownSeconds}s
              </Text>
            </Container>
            <Button
              onClick={onCountdownIncrease}
              variant="default"
              width={105}
              height={105}
              borderRadius={52.5}
              backgroundColor="rgba(220, 220, 220, 0.9)"
              disabled={countdownDisabled}
            >
              <Text fontSize={48} color="black" fontWeight="bold">
                +
              </Text>
            </Button>
          </Container>

          {/* Button Grid */}
          <Container
            flexDirection="column"
            gap={60}
            alignItems="center"
            justifyContent="center"
            width="100%"
          >
            {/* Start/reset row*/}
            <Container flexDirection="row" gap={60} justifyContent="center">
              <Button
                onClick={onStartTeleop}
                variant="default"
                width={480}
                height={120}
                borderRadius={40}
                backgroundColor="rgba(220, 220, 220, 0.9)"
                hover={{
                  backgroundColor: 'rgba(100, 150, 255, 1)',
                  borderColor: 'white',
                  borderWidth: 2,
                }}
                disabled={playDisabled}
              >
                <Container flexDirection="row" alignItems="center" gap={12}>
                  {playLabel === 'Play' && <Image src="./play-circle.svg" width={60} height={60} />}
                  <Text fontSize={48} color="black" fontWeight="medium">
                    {playLabel}
                  </Text>
                </Container>
              </Button>

              <Button
                onClick={onResetTeleop}
                variant="default"
                width={480}
                height={120}
                borderRadius={40}
                backgroundColor="rgba(220, 220, 220, 0.9)"
                hover={{
                  backgroundColor: 'rgba(100, 150, 255, 1)',
                  borderColor: 'white',
                  borderWidth: 2,
                }}
              >
                <Container flexDirection="row" alignItems="center" gap={12}>
                  <Image src="./arrow-uturn-left.svg" width={60} height={60} />
                  <Text fontSize={48} color="black" fontWeight="medium">
                    Reset
                  </Text>
                </Container>
              </Button>
            </Container>

            {/* Bottom Row */}
            <Container flexDirection="row" justifyContent="center">
              <Button
                onClick={onDisconnect}
                variant="destructive"
                width={330}
                height={105}
                borderRadius={35}
                backgroundColor="rgba(255, 150, 150, 0.9)"
                hover={{
                  backgroundColor: 'rgba(255, 50, 50, 1)',
                  borderColor: 'white',
                  borderWidth: 2,
                }}
              >
                <Container flexDirection="row" alignItems="center" gap={12}>
                  <Image src="./arrow-left-start-on-rectangle.svg" width={60} height={60} />
                  <Text fontSize={40} color="black" fontWeight="medium">
                    Disconnect
                  </Text>
                </Container>
              </Button>
            </Container>
          </Container>
        </Container>
      </Container>
    </group>
  );
}
