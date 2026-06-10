// CameraPose ⇔ THREE.PerspectiveCamera の変換（threeへの依存はthree/層のみ）
import * as THREE from 'three'
import type { CameraPose } from '../model/types'
import { focalToVFovDeg } from '../core/lens'
import { rad } from '../core/math'

export function applyPoseToCamera(
  cam: THREE.PerspectiveCamera, pose: CameraPose, aspect: number,
): void {
  cam.position.set(pose.position.x, pose.position.y, pose.position.z)
  cam.up.set(0, 1, 0)
  cam.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z)
  if (pose.roll) cam.rotateZ(rad(-pose.roll)) // 視軸まわりのロール
  cam.fov = focalToVFovDeg(pose.focalLength, aspect)
  cam.aspect = aspect
  cam.near = 0.05
  cam.far = 200
  cam.updateProjectionMatrix()
}

// フラスタム表示用のコーナー計算（距離distでのフレーム四隅、ワールド座標）
export function frustumCorners(pose: CameraPose, aspect: number, dist: number): THREE.Vector3[] {
  const cam = new THREE.PerspectiveCamera()
  applyPoseToCamera(cam, pose, aspect)
  cam.updateMatrixWorld()
  const vH = Math.tan(rad(cam.fov) / 2) * dist
  const vW = vH * aspect
  const corners = [
    new THREE.Vector3(-vW, vH, -dist),
    new THREE.Vector3(vW, vH, -dist),
    new THREE.Vector3(vW, -vH, -dist),
    new THREE.Vector3(-vW, -vH, -dist),
  ]
  return corners.map((c) => c.applyMatrix4(cam.matrixWorld))
}
