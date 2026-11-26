//
// Copyright Contributors to the MaterialX Project
// SPDX-License-Identifier: Apache-2.0
//

#include <JsMaterialX/Helpers.h>
#include "StrContainerTypeRegistration.h"
#include <MaterialXFormat/XmlIo.h>

#include <emscripten/bind.h>

namespace ems = emscripten;
namespace mx = MaterialX;

EMSCRIPTEN_BINDINGS(engine_materialx_format)
{
    ems::function("getMtlxExtension", ems::optional_override([]() { return mx::MTLX_EXTENSION; }));

    ems::class_<mx::XmlReadOptions>("XmlReadOptions")
        .constructor<>()
        .property<bool>("readXIncludes",
            [](const mx::XmlReadOptions& self) {
                return self.readXIncludeFunction != nullptr;
            },
            [](mx::XmlReadOptions& self, bool enabled) {
                self.readXIncludeFunction = enabled ? &mx::readFromXmlFile : nullptr;
            });

    BIND_FUNC_RAW_PTR("_readFromXmlFile", mx::readFromXmlFile, 2, 4,
        mx::DocumentPtr, mx::FilePath, mx::FileSearchPath, const mx::XmlReadOptions*);
    BIND_FUNC_RAW_PTR("readFromXmlString", mx::readFromXmlString, 2, 4,
        mx::DocumentPtr, const mx::string&, const mx::FileSearchPath&, const mx::XmlReadOptions*);
}
