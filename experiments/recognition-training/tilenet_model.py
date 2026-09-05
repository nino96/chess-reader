"""The frozen FENShot TileNet architecture and ONNX export wrapper."""

from __future__ import annotations

import torch
from torch import Tensor, nn
from torch.nn import functional as F


CLASS_ORDER = "1KQRBNPkqrbnp"
INPUT_NAME = "tiles"
OUTPUT_NAME = "probs"
INPUT_WIDTH = 32 * 32
CLASS_COUNT = len(CLASS_ORDER)


class TileNet(nn.Module):
    """Unchanged 321,805-parameter upstream classifier."""

    def __init__(self) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(1, 32, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.conv2 = nn.Conv2d(32, 64, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(64)
        self.conv3 = nn.Conv2d(64, 64, 3, padding=1)
        self.bn3 = nn.BatchNorm2d(64)
        self.fc1 = nn.Linear(64 * 4 * 4, 256)
        self.drop = nn.Dropout(0.2)
        self.fc2 = nn.Linear(256, CLASS_COUNT)

    def forward(self, tiles: Tensor) -> Tensor:
        x = tiles.reshape(-1, 1, 32, 32)
        x = F.max_pool2d(F.relu(self.bn1(self.conv1(x))), 2)
        x = F.max_pool2d(F.relu(self.bn2(self.conv2(x))), 2)
        x = F.max_pool2d(F.relu(self.bn3(self.conv3(x))), 2)
        x = x.flatten(1)
        x = self.drop(F.relu(self.fc1(x)))
        return self.fc2(x)


class ExportNet(nn.Module):
    """The upstream-compatible inference surface with a baked-in softmax."""

    def __init__(self, model: TileNet) -> None:
        super().__init__()
        self.model = model

    def forward(self, tiles: Tensor) -> Tensor:
        return F.softmax(self.model(tiles), dim=1)


def parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())
