"""Paired development comparison using saved probabilities; no new inference."""
import json
from pathlib import Path
import numpy as np
from assemble_feasibility import ROOT, encoded, digest, publish, read
from feasibility_train import diagnose, verify_lock

WORK=ROOT/'work/modern'


def metrics(prob, labels, rows):
    result=diagnose(prob,labels,rows)
    prediction=prob.argmax(2); correct=prediction==labels; confidence=prob.max(2)
    exact=correct.all(1)
    result['byColor']={name:{'correct':int((correct & mask).sum()),'total':int(mask.sum())} for name,mask in [('white',(labels>=1)&(labels<=6)),('black',labels>=7),('occupied',labels!=0)]}
    result['byDensity']={density:{'boards':int(mask.sum()),'exact':int(exact[mask].sum())} for density in sorted({r['density'] for r in rows}) for mask in [np.array([r['density']==density for r in rows])]}
    confusion=np.zeros((13,13),dtype=np.int64); np.add.at(confusion,(labels.ravel(),prediction.ravel()),1)
    result['confusion']=confusion.tolist()
    result['confidenceHistogram']={'edges':[0,.5,.7,.8,.9,.95,.99,1],'counts':np.histogram(confidence,bins=[0,.5,.7,.8,.9,.95,.99,1])[0].tolist()}
    result['exactIds']=[r['id'] for r,v in zip(rows,exact) if v]
    return result


def main():
    verify_lock(WORK/'dataset')
    runs=WORK/'feasibility-runs'; metadata=read(WORK/'dataset/dev.metadata.json')['boards']
    with np.load(WORK/'dataset/dev.npz',allow_pickle=False) as data: labels=data['labels']
    baseline_report=read(runs/'baseline-dev.json'); base_path=runs/'baseline-dev.probabilities.npy'
    if digest(base_path.read_bytes())!=baseline_report['probabilitiesSha256']: raise ValueError('baseline probabilities changed')
    baseline=np.load(base_path,allow_pickle=False); base_exact=(baseline.argmax(2)==labels).all(1)
    clean=np.array([r['clean'] for r in metadata]); degraded=np.array([r['condition']=='low-opacity-flat' for r in metadata])
    disjoint=set(read(WORK/'coverage.json')['positionDisjointDevIds'])
    result={'schema':1,'split':'source-held-out development only','baseline':metrics(baseline,labels,metadata),'candidates':{},'qualificationPassed':False,'heldOutScored':False,'degradedStratum':'one real low-opacity example; insufficient breadth for general degradation claims'}
    for name in ('real-only','degraded'):
        report=read(runs/name/'run-report.json'); path=runs/name/'candidate.probabilities.npy'
        if report['status']!='completed' or digest(path.read_bytes())!=report['parity']['probabilitiesSha256']: raise ValueError('candidate incomplete or probabilities changed')
        probabilities=np.load(path,allow_pickle=False); exact=(probabilities.argmax(2)==labels).all(1)
        block=metrics(probabilities,labels,metadata)
        block.update(bestEpoch=report['bestEpoch'],updates=report['updates'],elapsedSeconds=report['elapsedSeconds'],modelSha256=report['modelSha256'])
        block['paired']={'gainedIds':[r['id'] for r,m in zip(metadata,exact & ~base_exact) if m],'lostIds':[r['id'] for r,m in zip(metadata,~exact & base_exact) if m],'cleanBaselineCorrect':int((clean & base_exact).sum()),'cleanLosses':int((clean & base_exact & ~exact).sum()),'degradedBoards':int(degraded.sum()),'degradedExactGainPercentagePoints':float((exact[degraded].mean()-base_exact[degraded].mean())*100) if degraded.any() else None,'positionDisjointBoards':len(disjoint),'positionDisjointBaselineExact':sum(bool(b) and r['id'] in disjoint for r,b in zip(metadata,base_exact)),'positionDisjointCandidateExact':sum(bool(b) and r['id'] in disjoint for r,b in zip(metadata,exact))}
        paired=block['paired']
        block['regressedOccupiedClasses']=[symbol for symbol,stats in block['perClass'].items() if symbol!='1' and stats['correct']<result['baseline']['perClass'][symbol]['correct']]
        block['recommendationGatePassed']=paired['cleanLosses']==0 and paired['degradedExactGainPercentagePoints'] is not None and paired['degradedExactGainPercentagePoints']>=5 and block['confidentWrongBoards']<=result['baseline']['confidentWrongBoards'] and block['occupiedCorrect']>=result['baseline']['occupiedCorrect'] and not block['regressedOccupiedClasses']
        result['candidates'][name]=block
    publish(runs/'comparison-dev.json',encoded(result))
    print(json.dumps({'baselineExact':result['baseline']['rawExactBoards'],'boards':len(metadata),'candidates':{k:{'exact':v['rawExactBoards'],'reliableExact':v['reliableExactBoards'],'confidentWrong':v['confidentWrongBoards'],'paired':v['paired'],'recommendationGatePassed':v['recommendationGatePassed']} for k,v in result['candidates'].items()}},sort_keys=True))


if __name__=='__main__': main()
