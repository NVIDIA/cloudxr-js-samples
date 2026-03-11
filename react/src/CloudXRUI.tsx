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
 * - Generic interactive action buttons (Action 1, Action 2, Disconnect)
 * - Responsive button layout with hover effects
 * - Integration with parent component event handlers
 * - Configurable position and rotation in world space for flexible UI placement
 * - Draggable handle bar for repositioning the UI in 3D space
 * - Face-camera rotation for optimal viewing angle (Y-axis only)
 *
 * The UI is positioned in 3D space and designed for VR/AR interaction with
 * visual feedback and clear button labeling. All interactions are passed
 * back to the parent component through callback props.
 */

import { useXRButton } from '@helpers/react/useXRButton';
import { useFrame } from '@react-three/fiber';
import { Handle, HandleTarget } from '@react-three/handle';
import { Container, Text, Image } from '@react-three/uikit';
import { Button } from '@react-three/uikit-default';
import React, { useRef, useEffect } from 'react';
import { Color, Euler, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { damp } from 'three/src/math/MathUtils.js';

const FACE_CAMERA_DAMPING = 10;

interface CloudXRUIProps {
  onAction1?: () => void;
  onAction2?: () => void;
  onDisconnect?: () => void;
  serverAddress?: string;
  sessionStatus?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

// Reusable objects for face-camera rotation (avoid allocations in render loop)
const eulerHelper = new Euler();
const quaternionHelper = new Quaternion();
const cameraPositionHelper = new Vector3();
const uiPositionHelper = new Vector3();
const zAxis = new Vector3(0, 0, 1);

const HANDLE_COLOR_DEFAULT = new Color('#666666');
const HANDLE_COLOR_HOVER = new Color('#aaaaaa');

export default function CloudXR3DUI({
  onAction1,
  onAction2,
  onDisconnect,
  serverAddress = '127.0.0.1',
  sessionStatus = 'Disconnected',
  position = [1.8, 1.75, -1.3],
  rotation = [0, -0.3, 0],
}: CloudXRUIProps) {
  const groupRef = useRef<Group>(null);
  const handleRef = useRef<Mesh>(null);
  const xrButton = useXRButton();

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(position[0], position[1], position[2]);
    }
  }, [position[0], position[1], position[2]]);

  // Face-camera rotation: smoothly rotate UI to face the user (Y-axis only)
  useFrame((state, dt) => {
    if (groupRef.current === null) {
      return;
    }
    state.camera.getWorldPosition(cameraPositionHelper);
    groupRef.current.getWorldPosition(uiPositionHelper);
    quaternionHelper.setFromUnitVectors(
      zAxis,
      cameraPositionHelper.sub(uiPositionHelper).normalize()
    );
    eulerHelper.setFromQuaternion(quaternionHelper, 'YXZ');
    groupRef.current.rotation.y = damp(
      groupRef.current.rotation.y,
      eulerHelper.y,
      FACE_CAMERA_DAMPING,
      dt
    );
  });

  return (
    <HandleTarget>
      <group
        ref={groupRef}
        position={position}
        rotation={rotation}
        pointerEventsType={{ deny: 'grab' }}
      >
        {/* Drag Handle Bar - grab to reposition the panel */}
        <Handle
          handleRef={handleRef}
          targetRef={groupRef}
          scale={false}
          multitouch={false}
          rotate={false}
        >
          <mesh
            ref={handleRef}
            position={[0, -0.4, 0.01]}
            onPointerEnter={() => {
              const mat = handleRef.current?.material as MeshStandardMaterial | undefined;
              if (mat) {
                mat.color.copy(HANDLE_COLOR_HOVER);
                mat.opacity = 0.9;
              }
            }}
            onPointerLeave={() => {
              const mat = handleRef.current?.material as MeshStandardMaterial | undefined;
              if (mat) {
                mat.color.copy(HANDLE_COLOR_DEFAULT);
                mat.opacity = 0.6;
              }
            }}
          >
            <boxGeometry args={[1.0, 0.05, 0.02]} />
            <meshStandardMaterial color="#666666" transparent opacity={0.6} roughness={0.5} />
          </mesh>
        </Handle>

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

            {/* Button Grid */}
            <Container
              flexDirection="column"
              gap={60}
              alignItems="center"
              justifyContent="center"
              width="100%"
            >
              {/* Action buttons row */}
              <Container flexDirection="row" gap={60} justifyContent="center">
                <Button
                  {...xrButton('action1', onAction1)}
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
                  <Text fontSize={48} color="black" fontWeight="medium">
                    Action 1
                  </Text>
                </Button>

                <Button
                  {...xrButton('action2', onAction2)}
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
                  <Text fontSize={48} color="black" fontWeight="medium">
                    Action 2
                  </Text>
                </Button>
              </Container>

              {/* Bottom Row */}
              <Container flexDirection="row" justifyContent="center">
                <Button
                  {...xrButton('disconnect', onDisconnect)}
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
    </HandleTarget>
  );
}
