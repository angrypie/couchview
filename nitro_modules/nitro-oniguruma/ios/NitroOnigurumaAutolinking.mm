//
// NitroOnigurumaAutolinking.mm
// Registers the "Oniguruma" hybrid object constructor with Nitro's
// HybridObjectRegistry. Uses ObjC's +load so the registration survives static
// library linking (constructor attributes can be dead-stripped).
//

#import <Foundation/Foundation.h>
#import <NitroModules/HybridObjectRegistry.hpp>

#include "HybridOniguruma.hpp"

@interface NitroOnigurumaAutolinking : NSObject
@end

@implementation NitroOnigurumaAutolinking

+ (void)load {
	using namespace margelo::nitro;

	HybridObjectRegistry::registerHybridObjectConstructor(
		"Oniguruma",
		[]() -> std::shared_ptr<HybridObject> {
			return std::make_shared<nitro_onig::HybridOniguruma>();
		}
	);
}

@end
