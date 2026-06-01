import torch
import torch.nn as nn

class SigFormerDeepHedger(nn.Module):
    """
    SigVol: Neural Stochastic Control Policy via Path Signatures.
    Optimizes discrete delta-hedging trajectory against a CVaR objective 
    to minimize microstructural transaction costs.
    """
    def __init__(self, signature_depth=4, hidden_dim=256):
        super().__init__()
        self.signature_encoder = nn.Linear(781, hidden_dim) # Depth-4 truncation
        self.lstm = nn.LSTM(hidden_dim, hidden_dim, batch_first=True)
        self.hedge_ratio_head = nn.Linear(hidden_dim, 1)

    def forward(self, path_signature):
        # Extracts universal LOB state representation
        x = torch.relu(self.signature_encoder(path_signature))
        x, _ = self.lstm(x)
        return torch.sigmoid(self.hedge_ratio_head(x)) # Returns delta adjustment
