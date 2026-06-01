import polars as pl
import numpy as np
import scipy.stats as si
import json
import os

# --- Parameters ---
DATA_DIR = "Bloomberg-Microstructure-Data/storage"
SPY_FILE = os.path.join(DATA_DIR, "spy_raw_inception_1min.parquet")
VIX_FILE = os.path.join(DATA_DIR, "vix_raw_inception_1min.parquet")
OUTPUT_FILE = "market_playback.json"

START_TIME = "2026-02-12 14:32:00"
END_TIME = "2026-02-12 16:31:00"

# Surface Grid
DTE_LIST = [1, 3, 5, 7, 14, 21, 30, 60, 90, 120]
STRIKE_PCTS = np.linspace(-0.15, 0.15, 31)

# Portfolio configuration
# Short 1 DTE ATM straddle (-1000 contracts)
# Long 120 DTE 15% OTM wings (+1000 contracts each)
CONTRACT_MULTIPLIER = 1000 * 100  # 100 shares per contract

def bs_call_put(S, K, T, r, sigma, option_type="call"):
    T = max(T, 1e-5)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    if option_type == "call":
        return S * si.norm.cdf(d1) - K * np.exp(-r * T) * si.norm.cdf(d2)
    else:
        return K * np.exp(-r * T) * si.norm.cdf(-d2) - S * si.norm.cdf(-d1)

def bs_delta(S, K, T, r, sigma, option_type="call"):
    T = max(T, 1e-5)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    if option_type == "call":
        return si.norm.cdf(d1)
    else:
        return si.norm.cdf(d1) - 1.0

def bs_gamma(S, K, T, r, sigma):
    T = max(T, 1e-5)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    return si.norm.pdf(d1) / (S * sigma * np.sqrt(T))

def bs_vega(S, K, T, r, sigma):
    T = max(T, 1e-5)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    return S * si.norm.pdf(d1) * np.sqrt(T)

def rbergomi_iv(S, K, dte, vix_spot):
    # Asymptotic rough Bergomi approximation
    # sigma_BS(k, T) ~ VIX * (1 + rho*eta * k * T^{H-1/2} + ...)
    # H = 0.1 for rough volatility
    H = 0.1
    T = max(dte / 365.0, 1e-5)
    k = np.log(K / S)
    
    base_vol = vix_spot / 100.0
    
    # Skew blows up as T^(H-0.5). To avoid exact infinity at T->0, clip T.
    T_skew = max(T, 1/365.0) 
    
    # Skew coefficient
    skew = -1.2 * k * (T_skew ** (H - 0.5))
    
    # Convexity (smile)
    convexity = 2.0 * (k ** 2) * (T_skew ** (2 * H - 1.0))
    
    iv = base_vol * (1.0 + skew + convexity)
    
    # ensure realistic boundaries
    iv = max(iv, 0.01)
    iv = min(iv, 3.0)
    
    return iv

def main():
    print("Loading data...")
    spy = pl.read_parquet(SPY_FILE)
    vix = pl.read_parquet(VIX_FILE)
    
    spy = spy.rename({col: col.lower() for col in spy.columns})
    vix = vix.rename({col: col.lower() for col in vix.columns})
    
    spy = spy.filter(
        (pl.col("datetime") >= pl.datetime(2026, 2, 12, 14, 32, 0)) &
        (pl.col("datetime") <= pl.datetime(2026, 2, 12, 16, 31, 0))
    ).sort("datetime")
    
    vix = vix.filter(
        (pl.col("datetime") >= pl.datetime(2026, 2, 12, 14, 32, 0)) &
        (pl.col("datetime") <= pl.datetime(2026, 2, 12, 16, 31, 0))
    ).sort("datetime")
    
    # Join on datetime
    df = spy.join(vix, on="datetime", how="inner")
    
    playback_data = []
    
    print("Synthesizing market data...")
    for row in df.iter_rows(named=True):
        t_str = row["datetime"].strftime("%H:%M:%S")
        S = row["spy_px_last"]
        V = row["vix_px_last"]
        
        # 1. Generate Surface
        vol_surface = []
        for dte in DTE_LIST:
            for pct in STRIKE_PCTS:
                K = S * (1.0 + pct)
                iv = rbergomi_iv(S, K, dte, V)
                vol_surface.append({
                    "strike": round(K, 2),
                    "dte": dte,
                    "iv": round(iv, 4)
                })
        
        # 2. Calculate Portfolio Greeks
        r = 0.05 # 5% risk free rate
        
        # Short ATM straddle 1 DTE (-1000)
        K_atm = S
        iv_atm = rbergomi_iv(S, K_atm, 1, V)
        d_c_atm = bs_delta(S, K_atm, 1/365, r, iv_atm, "call")
        d_p_atm = bs_delta(S, K_atm, 1/365, r, iv_atm, "put")
        g_atm = bs_gamma(S, K_atm, 1/365, r, iv_atm)
        v_atm = bs_vega(S, K_atm, 1/365, r, iv_atm)
        
        net_delta = -1000 * CONTRACT_MULTIPLIER * (d_c_atm + d_p_atm)
        total_gamma = -1000 * CONTRACT_MULTIPLIER * (g_atm + g_atm) # Both call and put have same gamma
        total_vega = -1000 * CONTRACT_MULTIPLIER * (v_atm + v_atm)
        
        # Long 120 DTE -15% Put (+1000)
        K_put_wing = S * 0.85
        iv_put_wing = rbergomi_iv(S, K_put_wing, 120, V)
        net_delta += 1000 * CONTRACT_MULTIPLIER * bs_delta(S, K_put_wing, 120/365, r, iv_put_wing, "put")
        total_gamma += 1000 * CONTRACT_MULTIPLIER * bs_gamma(S, K_put_wing, 120/365, r, iv_put_wing)
        total_vega += 1000 * CONTRACT_MULTIPLIER * bs_vega(S, K_put_wing, 120/365, r, iv_put_wing)
        
        # Long 120 DTE +15% Call (+1000)
        K_call_wing = S * 1.15
        iv_call_wing = rbergomi_iv(S, K_call_wing, 120, V)
        net_delta += 1000 * CONTRACT_MULTIPLIER * bs_delta(S, K_call_wing, 120/365, r, iv_call_wing, "call")
        total_gamma += 1000 * CONTRACT_MULTIPLIER * bs_gamma(S, K_call_wing, 120/365, r, iv_call_wing)
        total_vega += 1000 * CONTRACT_MULTIPLIER * bs_vega(S, K_call_wing, 120/365, r, iv_call_wing)
        
        frame = {
            "timestamp": t_str,
            "spot_price": round(S, 2),
            "vix_level": round(V, 2),
            "greeks": {
                "net_delta": int(net_delta),
                "total_gamma": int(total_gamma),
                "total_vega": int(total_vega / 100) # Vega is usually presented per 1% vol change. Our formula is per 100% vol change.
            },
            "vol_surface": vol_surface
        }
        playback_data.append(frame)
    
    print(f"Exporting {len(playback_data)} frames to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, "w") as f:
        json.dump(playback_data, f)
        
    print("Done!")

if __name__ == "__main__":
    main()
